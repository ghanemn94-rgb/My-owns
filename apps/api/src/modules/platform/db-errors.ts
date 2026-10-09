// Problem mapping of PostgreSQL errors raised by the P2 database record guards and template constraints (ADR-0016 §3,
// ADR-0015). The API checks every rule first; these errors only surface when a request slips past an API check (or two
// requests race), and the database is the last line of defence. Mapping (p2-work-split §2):
//   <table>_version_step                     -> 409 version-conflict (optimistic concurrency, ADR-0003)
//   gate_decision_not_submitter              -> 403 gate.submitter_cannot_decide (separation of duties)
//   evidence_review_separation (0019)        -> 403 evidence.reviewer_is_author (separation of duties, F-DG2-140)
//   gate_decision_current_submission         -> 409 version-conflict, code gate.submission_superseded
//   template CHECK / NOT NULL violations     -> 422 / 400 with a field pointer derived from the column
//   22021 character_not_in_repertoire,
//   22P05 untranslatable_character          -> 400 validation.invalid_character (F-DG2-231: defence in depth behind
//                                              the central U+0000 request check; text the database cannot store)
//   <table>_audit_required, append-only,
//   identity/organization guards, snapshots   -> 500 (a programming error, never user-facing detail)
// P3 (T-DG3-BE-A; p3-work-split §2 BE-A; ADR-0021..0024):
//   initiative_status_transition             -> 422 invalid-transition (an edge outside ADR-0021 §3)
//   dependency_acyclic                       -> 422 dependency.cycle, detail "Dependency cycle: INI-01 → … → INI-01"
//                                              and the `cycle` member, both from the database message (ADR-0023 §4)
//   scoring_weight_set_total                 -> 422 prioritization.weights_total, "Weights must total 100% (got N%)"
//   *_validator_not_author, *_approver_not_proposer, *_decider_not_recorder,
//   deliverable_acceptor_not_submitter       -> 403 (separation of duties)
//   named P3 CHECKs (date ranges, shapes)    -> 422 validation.constraint with the field pointer
// P4 slices I and C (T-DG4-BE-A; p4-work-split §I+C.1; ADR-0025 §1, §3, §4; ADR-0026 §2-§7). The services check first;
// these are the database's last line, with the slice ADRs' exact codes and English texts (S-11). Placeholders the
// database cannot know (a person's name) are filled from the error message where it carries them, else generically:
//   business_calendar_workweek_valid         -> 422 calendar.workweek_invalid
//   business_calendar_timezone_known         -> 422 calendar.timezone_unknown ({timezone} from the message)
//   job_schedule_timezone_known              -> 422 job.timezone_unknown ({timezone} from the message)
//   business_calendar_org_code_key           -> 409 calendar.code_taken (duplicate)
//   business_calendar_holiday_range          -> 422 calendar.holiday_range_invalid
//   work_item_closed                         -> 422 work_item.closed
//   inbox_notification_read_once             -> 422 inbox.already_read
//   delegation_no_loop                       -> 422 delegation.loop
//   role_mapping_active_key                  -> 409 role_mapping.already_mapped (duplicate)
//   transformation_raci_assignment_value     -> 422 raci.invalid_value
//   transformation_raci_one_accountable      -> 422 raci.accountable_count
//   *_matrix_in_approval                     -> 422 governance_matrix.in_approval
//   approval_one_open_per_subject            -> 409 approval.already_open (duplicate)
//   approval_decision_stale,
//   approval_subject_version_current         -> 409 approval.stale_version (versions from the message)
//   approval_decision_sod                    -> 403 approval.sod_requester
//   approval_decision_rationale_required     -> 422 approval.rationale_required
//   approval_decision_defer_date             -> 422 approval.defer_date_required
//   approval_decision_open,
//   approval_final_immutable                 -> 422 approval.not_open ({status} from the message)
//   work_item_identity, inbox_notification_identity -> 500 (immutable columns; a programming error)
// P4 slice A, KBE-B part (T-DG4-KBE-B; p4-work-split §A.2; ADR-0027 §13): KPI versions, formula cycles, thresholds,
// trajectories and data-quality findings, with ADR-0027 §13's exact codes and English texts (S-11):
//   kpi_version_complete_when_active          -> 422 kpi_version.aggregation_rule_required (the service checks the
//                                                ratio labels and the milestone due date first, with their own codes)
//   kpi_version_aggregation_fits_nature       -> 422 kpi_version.aggregation_not_allowed (rule and nature from the row)
//   kpi_version_custom_formula_approved       -> 422 kpi_version.custom_formula_needs_approval
//   kpi_version_measure_fits_polarity         -> 422 kpi_version.measure_mismatch (types from the message)
//   kpi_version_band                          -> 422 kpi_version.band_required
//   kpi_version_route_reviewer                -> 422 kpi_version.reviewer_required
//   kpi_version_change_reason                 -> 422 kpi_version.change_reason_required
//   kpi_version_one_draft                     -> 409 kpi_version.draft_exists (duplicate)
//   kpi_version_status_step, kpi_version_frozen -> 422 kpi_version.not_draft
//   kpi_version_definition_active             -> 422 kpi_version.definition_not_active
//   kpi_version_approval_required             -> 422 kpi_version.approval_required
//   kpi_definition_measure_locked             -> 422 kpi_definition.measure_locked (updateKpiDefinition, D-091 (2))
//   kpi_formula_no_cycle                      -> 422 kpi_formula.circular (the variable from the message; the service
//                                                names the full path first)
//   kpi_rag_threshold_order                   -> 422 kpi_threshold.order
//   target_trajectory_scope_valid (and every *_scope_valid of slice A) -> 422 kpi.scope_invalid
//   target_trajectory_points_required         -> 422 target_trajectory.points_required
//   target_trajectory_one_draft               -> 409 target_trajectory.draft_exists (duplicate)
//   target_trajectory_status_step, target_trajectory_frozen -> 422 target_trajectory.not_draft
//   target_trajectory_approver_not_creator    -> 403 target_trajectory.approver_is_author
//   data_quality_finding_status_step          -> 422 data_quality.not_open
//   data_quality_finding_resolution           -> 422 data_quality.note_required
// P4 slice A, KBE-C part (T-DG4-KBE-C; p4-work-split §A.3; ADR-0027 §13): reporting periods, actuals, overrides:
//   reporting_period_label_key -> 409 reporting_period.label_taken; reporting_period_no_overlap / _weeks / _range /
//   _status_step -> 422 reporting_period.*; kpi_actual_period_open / _period_frequency / _value_currency / _value_shape
//   / _value_active_version / _reject_reason / _status_step -> 422 kpi_actual.*; kpi_actual_review_sod -> 403
//   kpi_actual.sod_submitter; kpi_actual_slot_key -> 409 version conflict; rag_override_one_in_force -> 409
//   rag_override.already_in_force; rag_override_expiry_window / _status_step -> 422 rag_override.*;
//   kpi_actual_value_present, kpi_actual_review_present -> 500 (a programming error)
// Pure: no I/O, unit-tested in platform.test.ts and db-errors.test.ts.
import { PROBLEM_TYPES, type ProblemDetails } from "@mth/shared";
import { HttpProblem, problems } from "./problem.ts";
import { invalidCharacterProblem } from "./validation.ts";

/** The fields node-postgres puts on a DatabaseError (subset). */
export interface PgErrorLike {
  readonly code?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  /** The primary message (P3: the dependency cycle path and the weight total are read from it). */
  readonly message?: string;
  /** DETAIL (P3: dependency_acyclic puts the cycle's initiative ids here, comma-separated). */
  readonly detail?: string;
}

/** One node of a reported dependency cycle (ADR-0023 §4); the first node is repeated at the end. */
export interface CycleNode {
  readonly initiativeId: string;
  readonly code: string;
  readonly name?: string;
}

/**
 * 422 dependency.cycle (ADR-0023 §4) with the `cycle` extension member. Used for the mapped database error and by the
 * API's own friendly check (BE-C), so both answer the same body: detail "Dependency cycle: INI-01 → INI-02 → INI-01",
 * errors[0] at /toInitiativeId with the same text.
 */
export class DependencyCycleProblem extends HttpProblem {
  readonly cycle: readonly CycleNode[];
  constructor(cycle: readonly CycleNode[]) {
    const text = `Dependency cycle: ${cycle.map((n) => n.code).join(" → ")}`;
    super({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "dependency.cycle",
      title: "Business rule violated",
      detail: text,
      errors: [{ pointer: "/toInitiativeId", code: "dependency.cycle", message: text }],
    });
    this.cycle = cycle;
  }
  override toBody(requestId: string, instance?: string): ProblemDetails & { cycle: readonly CycleNode[] } {
    return { ...super.toBody(requestId, instance), cycle: this.cycle };
  }
}

/** The cycle of a dependency_acyclic error: codes from "dependency cycle: A -> B -> A", ids from DETAIL. */
export function cycleOfDatabaseError(error: PgErrorLike): CycleNode[] {
  const path = /dependency cycle: (.+)$/.exec(error.message ?? "")?.[1] ?? "";
  const codes = path === "" ? [] : path.split(" -> ").map((c) => c.trim());
  const ids = (error.detail ?? "").split(",").map((i) => i.trim());
  return codes.map((code, i) => ({ initiativeId: ids.at(i) ?? "", code }));
}

/** Separation-of-duties CHECKs (P3) -> 403 with a stable code. Suffix rules; the first match wins. */
const SEPARATION_OF_DUTIES: ReadonlyArray<{ suffix: string; code: string; detail: string }> = [
  {
    suffix: "_validator_not_author",
    code: "finance.validator_is_author",
    detail: "Finance validation is done by someone other than the record's author (separation of duties).",
  },
  {
    suffix: "_approver_not_proposer",
    code: "approval.approver_is_proposer",
    detail: "The person who proposed this cannot approve it (separation of duties).",
  },
  {
    suffix: "_decider_not_recorder",
    code: "dispensation.decider_is_recorder",
    detail:
      "A dispensation is accepted or rejected by someone other than the person who recorded it (separation of duties).",
  },
  {
    suffix: "_acceptor_not_submitter",
    code: "deliverable.acceptor_is_submitter",
    detail:
      "A deliverable is accepted or rejected by someone other than the person who submitted it (separation of duties).",
  },
];

/** Named P3 CHECK constraints and the request field they concern (the generic 23514 mapping cannot derive it). */
const P3_CHECK_POINTERS: ReadonlyMap<string, string> = new Map([
  ["initiative_planned_range", "/plannedEnd"],
  ["roadmap_wave_planned_range", "/plannedEnd"],
  ["roadmap_wave_horizon_range", "/horizonToWeeks"],
  ["initiative_gap_link_one_target", "/targetId"],
  ["dependency_not_self", "/toInitiativeId"],
  ["gate_dispensation_gate", "/gateCode"],
  ["gate_dispensation_inherited_shape", "/evidenceId"],
  ["gate_dispensation_waiver_shape", "/reason"],
  ["business_case_line_one_class", "/investmentClass"],
  ["business_case_line_period_range", "/periodEnd"],
  ["benefit_calculation_period_range", "/periodEnd"],
  // The contribution's KPI must belong to its outcome (0020 trigger; BE-B handback §7 item 1, T-DG3-BE-E).
  ["initiative_contribution_kpi_matches_outcome", "/outcomeKpiId"],
]);

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** snake_case column -> camelCase JSON pointer segment (the API's field naming). */
export function pointerOfColumn(column: string): string {
  return `/${column.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())}`;
}

/** Guards whose violation means the code forgot something; never the user's fault. */
const PROGRAMMING_ERROR_SUFFIXES = ["_audit_required", "_identity_immutable", "_organization_matches"] as const;
const PROGRAMMING_ERROR_CONSTRAINTS: ReadonlySet<string> = new Set([
  "charter_version_required",
  // 0025 (ADR-0021 §8): the API answers 422 gate.g1_agreements_required first; reaching the guard is a code defect.
  "gate_decision_g1_agreements",
  "gate_submission_immutable",
  "gate_submission_status_final",
  "methodology_version_published_immutable",
]);

/** Named business-rule constraints with a stable code (422) and the field they concern. */
const BUSINESS_RULES: ReadonlyMap<string, { code: string; detail: string; pointer: string }> = new Map([
  [
    "tom_workshop_close_unresolved",
    {
      code: "workshop.unresolved_items",
      detail: "Convert every unresolved item into a design decision or an owned action before closing the workshop.",
      pointer: "/status",
    },
  ],
  [
    "gate_instance_approver_allowed",
    {
      code: "gate.approver_role_not_allowed",
      detail: "This role is not an allowed approver for the gate.",
      pointer: "/approverRoleCode",
    },
  ],
  [
    "evidence_filename_never_verified",
    {
      code: "evidence.filename_never_verified",
      detail: "A bare filename reference can never be verified; upload the file or link accessible content.",
      pointer: "/result",
    },
  ],
  [
    "evidence_verified_rule",
    {
      code: "evidence.verification_rule",
      detail: "Verification needs accessible content and a reviewer other than the evidence's creator.",
      pointer: "/result",
    },
  ],
  [
    "outcome_acyclic",
    {
      code: "outcome.cycle",
      detail: "An outcome cannot be placed under its own descendant.",
      pointer: "/parentOutcomeId",
    },
  ],
  [
    "outcome_max_depth",
    {
      code: "outcome.too_deep",
      detail: "The outcome tree is at most six levels deep.",
      pointer: "/parentOutcomeId",
    },
  ],
  [
    "tom_canvas_cell_ready_complete",
    {
      code: "tom_canvas.ready_incomplete",
      detail: "A canvas box can be ready only with a target design and an owner.",
      pointer: "/status",
    },
  ],
  [
    "gate_submission_criterion_mandatory_complete",
    {
      code: "gate_criteria_incomplete",
      detail: "Every mandatory criterion must be complete before the gate can be submitted.",
      pointer: "",
    },
  ],
]);

const rule422 = (code: string, detail: string, pointer: string): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

/** The time zone named in a `p4_timezone_known` message ("<table>: unknown time zone <tz>"), or a neutral word. */
function timezoneOfMessage(error: PgErrorLike): string {
  return /unknown time zone (.+)$/.exec(error.message ?? "")?.[1]?.trim() ?? "given";
}

/** The two versions in an approval staleness message ("version 3 ... version 4" / "from version 3 to 4"). */
function versionsOfMessage(error: PgErrorLike): { requested: string; current: string } {
  const m = /version (\d+)\D+?(\d+)/.exec(error.message ?? "");
  return { requested: m?.[1] ?? "?", current: m?.[2] ?? "?" };
}

/**
 * P4 slices I and C (ADR-0025 §1, §3, §4; ADR-0026 §2-§7): the exact codes and English texts of the slice ADRs (S-11).
 * Null when the error is not one of them.
 */
export function mapP4GuardError(error: PgErrorLike): HttpProblem | null {
  const constraint = error.constraint ?? "";
  switch (constraint) {
    case "business_calendar_workweek_valid":
      return rule422(
        "calendar.workweek_invalid",
        "The workweek must list one to seven different weekdays (1 = Monday … 7 = Sunday).",
        "/workweek",
      );
    case "business_calendar_timezone_known":
      return rule422(
        "calendar.timezone_unknown",
        `The time zone ${timezoneOfMessage(error)} is not a known time zone.`,
        "/timezone",
      );
    case "job_schedule_timezone_known":
      return rule422(
        "job.timezone_unknown",
        `The time zone ${timezoneOfMessage(error)} is not a known time zone.`,
        "/timezone",
      );
    case "business_calendar_org_code_key": {
      // DETAIL of a unique violation: "Key (organization_id, code)=(<uuid>, <code>) already exists."
      const taken = /=\([^,]+, (.+)\) already exists/.exec(error.detail ?? "")?.[1] ?? "given";
      return problems.duplicate(
        "calendar.code_taken",
        `A calendar with the code ${taken} already exists in this organization.`,
      );
    }
    case "business_calendar_holiday_range":
      return rule422(
        "calendar.holiday_range_invalid",
        "A holiday ends on or after its start date and spans at most 31 days.",
        "/dateTo",
      );
    case "work_item_closed":
      return rule422("work_item.closed", "This task is already closed.", "");
    case "inbox_notification_read_once":
      return rule422("inbox.already_read", "This reminder is already marked as read.", "");
    case "delegation_no_loop":
      return rule422(
        "delegation.loop",
        "This delegation would create a loop: the delegate already delegates, directly or through others, to the delegator.",
        "/delegateUserId",
      );
    case "role_mapping_active_key":
      return problems.duplicate(
        "role_mapping.already_mapped",
        "This party is already mapped in this transformation. End the current mapping first.",
      );
    case "transformation_raci_assignment_value":
      return rule422("raci.invalid_value", "A RACI cell accepts A, R, C, I or A/R.", "/cells");
    case "transformation_raci_one_accountable":
      return rule422(
        "raci.accountable_count",
        "Each deliverable needs exactly one accountable (A or A/R), unless a documented governance rule permits otherwise.",
        "/cells",
      );
    case "approval_one_open_per_subject":
      return problems.duplicate("approval.already_open", "An approval for this record is already open.");
    case "approval_decision_stale":
    case "approval_subject_version_current": {
      const v = versionsOfMessage(error);
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "approval.stale_version",
        title: "Version conflict",
        detail: `The record changed after this approval was requested: version ${v.requested} was submitted and the record is now at version ${v.current}. Review the changes before deciding.`,
      });
    }
    case "approval_decision_sod":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "approval.sod_requester",
        title: "Forbidden",
        detail:
          "You requested this change, so you cannot decide it. The separation-of-duties policy requires a different approver.",
      });
    case "approval_decision_rationale_required":
      return rule422("approval.rationale_required", "Enter a rationale for this decision.", "/rationale");
    case "approval_decision_defer_date":
      return rule422("approval.defer_date_required", "A deferral needs a new date after today.", "/deferUntil");
    case "approval_decision_open":
    case "approval_final_immutable": {
      const status = /is (\w+) and cannot be decided|a (\w+) approval is final/.exec(error.message ?? "");
      return rule422(
        "approval.not_open",
        `This approval is ${status?.[1] ?? status?.[2] ?? "closed"} and can no longer be decided.`,
        "",
      );
    }
    case "work_item_identity":
    case "inbox_notification_identity":
      return problems.internal();
    default:
      if (constraint.endsWith("_matrix_in_approval"))
        return rule422(
          "governance_matrix.in_approval",
          "This matrix is waiting for approval. It can change again once the approval is decided or withdrawn.",
          "",
        );
      return null;
  }
}

// P4 slice B register block (T-DG4-KBE-D; p4-work-split §B.1; ADR-0029 §11 "Database last-line mappings"). The
// benefits services check every rule first with the same code and text; these mappings only answer when a request
// slips past an API check or two requests race. Placeholders the database cannot know ({valueClass}, {benefitCode},
// {missing}, {totalPercent}) are filled from the error message where it carries them, else generically. The overlap,
// scenario and valuation-method lines (KBE-D2) and the measurement and Finance lines (KBE-E) follow this block.
const forbidden403 = (code: string, detail: string): HttpProblem =>
  new HttpProblem({ status: 403, type: PROBLEM_TYPES.forbidden, code, title: "Forbidden", detail });

/** The total of a benefit_allocation_total message ("... total 1.100000 (above 100 %)") as a percentage, or "more than 100". */
function allocationPercentOfMessage(error: PgErrorLike): string {
  const m = /total ([0-9]+)(?:\.([0-9]+))? \(above/.exec(error.message ?? "");
  if (!m) return "more than 100";
  const frac = `${m[2] ?? ""}00`;
  const whole = `${m[1] === "0" ? "" : m[1]}${frac.slice(0, 2)}`.replace(/^0+(?=[0-9])/, "") || "0";
  const rest = frac.slice(2).replace(/0+$/, "");
  return `${whole}${rest === "" ? "" : `.${rest}`}`;
}

/**
 * P4 slice B register, lifecycle, enabler, allocation and group constraints (ADR-0029 §11): the exact codes and
 * English texts (S-11). Null when the error is not one of them.
 */
export function mapP4BenefitRegisterError(error: PgErrorLike): HttpProblem | null {
  const constraint = error.constraint ?? "";
  switch (constraint) {
    case "benefit_mapping_required":
      return rule422(
        "benefit.mapping_required",
        "A financial benefit needs a financial-statement line.",
        "/financialStatementLine",
      );
    case "benefit_kpi_required":
      return rule422(
        "benefit.kpi_required",
        "A non-financial benefit needs an agreed KPI.",
        "/measurementKpiDefinitionId",
      );
    case "benefit_type_fits_class":
      return rule422(
        "benefit.type_class_mismatch",
        "The value class does not fit the benefit type. Revenue uplift and margin are revenue classes; cash savings and avoided cost are cost classes.",
        "/valueClass",
      );
    case "benefit_non_financial_unmonetised":
      return rule422(
        "benefit.valuation_method_required",
        "A non-financial benefit has no SAR value (n/a) unless an approved valuation method is selected.",
        "/plannedValue",
      );
    case "benefit_valuation_method_approved":
    case "benefit_valuation_only_non_financial":
      return rule422(
        "benefit.valuation_method_not_approved",
        "The valuation method is not approved by Finance, or is in another currency.",
        "/valuationMethodId",
      );
    case "benefit_kpi_variable_bound":
      return rule422(
        "benefit.kpi_variable_unbound",
        "A KPI-fed formula variable needs both the measurement KPI and the formula.",
        "/measurementKpiVariable",
      );
    case "benefit_validator_not_owner":
      return rule422(
        "benefit.validator_is_owner",
        "The Finance validator cannot be the benefit's owner.",
        "/financeValidatorUserId",
      );
    case "benefit_baseline_validator_not_owner":
      return forbidden403(
        "benefit.baseline_validator_is_owner",
        "You own this benefit, so you cannot validate its baseline.",
      );
    case "benefit_lifecycle_step":
      return rule422(
        "benefit.lifecycle_step",
        "A benefit moves Identify → Plan → Enable → Measure, between Measure and Correct, and from Measure to Sustain, one step at a time.",
        "/toStep",
      );
    case "benefit_plan_outputs_present":
      return rule422(
        "benefit.plan_outputs_missing",
        "The Plan outputs are missing: baseline, formula or target. A benefit needs its baseline, formula, target and owner before Enable and Measure.",
        "",
      );
    case "benefit_enablers_required":
      return rule422(
        "benefit.enablers_missing",
        "The Enable output is missing: link at least one enabling initiative, deliverable or capability before Measure.",
        "",
      );
    case "benefit_correct_output_present":
      return rule422("benefit.recovery_plan_required", "The Correct step needs a recovery plan.", "/recoveryPlan");
    case "benefit_sustain_outputs_present":
      return rule422(
        "benefit.sustain_outputs_missing",
        "The Sustain step needs a BAU owner and a control cadence.",
        "",
      );
    case "benefit_parent_depth":
    case "benefit_not_own_parent":
      return rule422(
        "benefit.parent_depth",
        "A child benefit cannot have children, and a parent cannot be a child.",
        "/parentBenefitId",
      );
    case "benefit_parent_has_values":
      return rule422(
        "benefit.parent_has_values",
        "This benefit already has values, so it cannot become a parent. A parent is the roll-up of its children.",
        "/parentBenefitId",
      );
    case "benefit_parent_currency":
      return rule422("benefit.parent_currency", "A child benefit uses its parent's currency.", "/currency");
    case "benefit_measure_locked":
      return rule422(
        "benefit.measure_locked",
        "This benefit has values, so its type, class and currency can no longer change.",
        "/valueClass",
      );
    case "benefit_case_line_valid":
      return rule422(
        "benefit.case_line_invalid",
        "The business-case line must be a benefit line of this transformation.",
        "/businessCaseLineId",
      );
    case "benefit_one_case_line_key":
      return problems.duplicate("benefit.case_line_taken", "This business-case line already backs another benefit.");
    case "benefit_code_key":
    case "benefit_group_code_key":
      // A concurrent code allocation: retry.
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "benefit_archived_frozen":
      return rule422("benefit.archived", "This benefit is archived and read-only.", "");
    case "benefit_enabler_deliverable_initiative":
      return rule422(
        "benefit_enabler.deliverable_initiative",
        "The deliverable must belong to the enabling initiative.",
        "/deliverableId",
      );
    case "benefit_enabler_frozen":
      return rule422("benefit_enabler.removed", "This enabler link is removed.", "");
    case "benefit_enabler_active_key":
      return problems.duplicate("benefit_enabler.exists", "This enabler is already linked to the benefit.");
    case "benefit_allocation_total":
      return rule422(
        "benefit_allocation.over_100",
        `The allocations total ${allocationPercentOfMessage(error)} %, above 100 %. Reduce them so they total 100 % or less.`,
        "/allocations",
      );
    case "benefit_allocation_initiative_key":
      return rule422(
        "benefit_allocation.duplicate_initiative",
        "Each initiative appears once in a benefit's allocations.",
        "/allocations",
      );
    case "benefit_allocation_share_check":
      return rule422("benefit_allocation.share_invalid", "Each share is above 0 % and at most 100 %.", "/allocations");
    case "benefit_group_counted_member":
      return error.table === "benefit_group"
        ? rule422(
            "benefit_group.counted_not_member",
            "The counted benefit must be a member of the group.",
            "/countedBenefitId",
          )
        : rule422(
            "benefit_group.counted_member_leaving",
            "This benefit is the counted member of its shared-benefit group. Name another counted member first.",
            "/benefitGroupId",
          );
    case "benefit_allocation_current_set":
    case "benefit_allocation_set_step":
      return problems.internal();
    default:
      return null;
  }
}

// P4 slice B, KBE-D2 lines (T-DG4-KBE-D2; p4-work-split §B.2; ADR-0029 §11 "Database last-line mappings"): overlap
// warnings, scenarios and valuation methods. The services check every rule first with the same code and text; these
// answer only when a request slips past an API check or two requests race. Placeholders the database cannot know
// ({kind}, {benefitCode}, {periodStart}) are filled from the error's DETAIL where it carries them, else generically.

/** The `kind` of a benefit_scenario_one_kind_key DETAIL ("Key (transformation_id, kind)=(<uuid>, upside) ..."). */
function scenarioKindOfDetail(error: PgErrorLike): string | null {
  return /\(transformation_id, kind\)=\([0-9a-f-]{36}, (base|upside|downside)\)/.exec(error.detail ?? "")?.[1] ?? null;
}

/**
 * P4 slice B overlap, scenario and valuation-method constraints (ADR-0029 §7, §8, §10, §11): the exact codes and
 * English texts (S-11). Null when the error is not one of them.
 */
export function mapP4BenefitD2Error(error: PgErrorLike): HttpProblem | null {
  const constraint = error.constraint ?? "";
  switch (constraint) {
    // valuation methods (§8)
    case "benefit_valuation_method_decider_not_proposer":
      return forbidden403(
        "benefit_valuation_method.decider_is_proposer",
        "The person who proposed this valuation method cannot decide it.",
      );
    case "benefit_valuation_method_status_step":
    case "benefit_valuation_method_frozen":
      return rule422(
        "benefit_valuation_method.not_proposed",
        "Only a proposed valuation method can be decided.",
        "/decision",
      );
    case "benefit_valuation_method_decision_complete":
      return rule422("benefit_valuation_method.note_required", "A rejection needs a note.", "/note");
    case "benefit_valuation_method_code_key":
      // A concurrent code allocation: retry.
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    // scenarios (§10)
    case "benefit_scenario_one_kind_key": {
      const kind = scenarioKindOfDetail(error);
      return problems.duplicate(
        "benefit_scenario.kind_exists",
        kind === null
          ? "This transformation already has an active scenario of this kind."
          : `This transformation already has an active ${kind} scenario.`,
      );
    }
    case "benefit_scenario_value_currency":
      return rule422(
        "benefit_value.currency_mismatch",
        "The value is in another currency than the benefit. Values are never converted.",
        "/currency",
      );
    case "benefit_scenario_value_unmonetised":
      return rule422(
        "benefit_value.unmonetised",
        "A non-financial benefit has no SAR value without an approved valuation method. Record its KPI value instead.",
        "/amount",
      );
    case "benefit_scenario_value_leaf_only":
      return rule422(
        "benefit_value.parent_rollup",
        "This benefit is a parent: its values come from its children.",
        "/benefitId",
      );
    case "benefit_scenario_value_benefit_active":
      return rule422("benefit.archived", "This benefit is archived and read-only.", "/benefitId");
    case "benefit_scenario_value_period_key":
      return problems.duplicate(
        "benefit_value.period_taken",
        "This benefit already has a scenario value for the period starting on this date.",
      );
    case "benefit_scenario_value_period_range":
      return rule422("benefit_value.period_range", "The period end cannot be before the period start.", "/periodEnd");
    case "benefit_scenario_value_present":
      return rule422("benefit_value.value_required", "A scenario value needs an amount or a KPI value.", "/amount");
    case "benefit_scenario_value_frozen":
      return problems.internal();
    // overlap warnings (§7)
    case "benefit_overlap_pair_order":
      return problems.internal();
    case "benefit_overlap_one_open_key":
      return problems.duplicate(
        "benefit_overlap.already_open",
        "An open overlap warning already exists for these two benefits.",
      );
    case "benefit_overlap_status_step":
      return rule422("benefit_overlap.not_open", "Only an open overlap warning can be resolved.", "");
    case "benefit_overlap_resolution_complete":
      return rule422(
        "benefit_overlap.excluded_required",
        "A duplicate resolution names which of the two benefits is not counted.",
        "/excludedBenefitId",
      );
    case "benefit_overlap_resolver_not_owner":
      return forbidden403(
        "benefit_overlap.resolver_is_owner",
        "You own one of the overlapping benefits, so you cannot resolve this overlap.",
      );
    default:
      return null;
  }
}

// P4 slice B, KBE-E lines (T-DG4-KBE-E; p4-work-split §B.3; ADR-0030 §11 "Database last-line mappings", ADR-0029 §11
// for the plan-value table): measurements, Finance validation, corrections and planned/forecast values. The services
// check every rule first with the same code and text; these answer only when a request slips past an API check or two
// requests race. Placeholders the database cannot know ({benefitCode}, {periodStart}, {missing}) are generic here.
// benefit_measurement_run_key, finance_validation_one_per_measurement and finance_validation_idempotency_key are the
// worker's "already done" signals (exactly-once queue items); through the API they can only mean a race: 409.

/**
 * P4 slice B measurement, Finance validation, correction and plan-value constraints (ADR-0030 §11): the exact codes and
 * English texts (S-11). Null when the error is not one of them.
 */
export function mapP4BenefitValueError(error: PgErrorLike): HttpProblem | null {
  const constraint = error.constraint ?? "";
  switch (constraint) {
    case "benefit_measurement_step":
      return rule422(
        "benefit_measurement.step",
        "This benefit is not at the Measure step yet. Measurements start at Measure; a delivered enabler is not realized value.",
        "",
      );
    case "benefit_measurement_period_required":
      return rule422(
        "benefit_measurement.period_required",
        "A measurement needs its measurement period before it is submitted.",
        "/periodStart",
      );
    case "benefit_measurement_period_key":
      return problems.duplicate(
        "benefit_measurement.period_taken",
        "This benefit already has a live measurement for this period. Correct that one instead.",
      );
    case "benefit_measurement_value_present":
    case "benefit_measurement_missing_shape":
      return rule422(
        "benefit_measurement.value_shape",
        "Enter an amount, a KPI value, or why the value is not available.",
        "/amount",
      );
    case "benefit_measurement_status_step":
    case "benefit_measurement_final":
    case "benefit_measurement_submitted_frozen":
      return rule422("benefit_measurement.not_draft", "Only a draft measurement can be changed or submitted.", "");
    case "benefit_measurement_validated_immutable":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.invalidTransition,
        code: "benefit_measurement.validated_immutable",
        title: "Invalid transition",
        detail: "A validated value is never edited. Record an amendment or a reversal.",
      });
    case "benefit_measurement_input_same_period":
      return rule422(
        "benefit_measurement.lineage_period",
        "Every input is for the measurement period.",
        "/periodStart",
      );
    case "benefit_measurement_basis_validated":
      return rule422(
        "finance_validation.basis_provisional",
        "The comparison basis is not validated by Finance, so this value is provisional. Validate the benefit's baseline and its formula version first.",
        "",
      );
    case "benefit_measurement_currency":
    case "benefit_plan_value_currency":
      return rule422(
        "benefit_value.currency_mismatch",
        "The value is in another currency than the benefit. Values are never converted.",
        "/currency",
      );
    case "benefit_measurement_unmonetised":
    case "benefit_plan_value_unmonetised":
      return rule422(
        "benefit_value.unmonetised",
        "A non-financial benefit has no SAR value without an approved valuation method. Record its KPI value instead.",
        "/amount",
      );
    case "benefit_measurement_leaf_only":
    case "benefit_plan_value_leaf_only":
      return rule422("benefit_value.parent_rollup", "This benefit is a parent: its values come from its children.", "");
    case "benefit_measurement_benefit_active":
    case "benefit_plan_value_benefit_active":
      return rule422("benefit.archived", "This benefit is archived and read-only.", "");
    case "benefit_plan_value_period_key":
      return problems.duplicate(
        "benefit_value.period_taken",
        "This benefit already has a value of this kind for the period starting on this date.",
      );
    case "benefit_plan_value_period_range":
    case "benefit_measurement_period_range":
      return rule422("benefit_value.period_range", "The period end cannot be before the period start.", "/periodEnd");
    case "benefit_plan_value_present":
      return rule422(
        "benefit_value.value_required",
        "A planned or forecast value needs an amount or a KPI value.",
        "/amount",
      );
    case "benefit_measurement_validator_not_submitter":
    case "finance_validation_sod":
      return forbidden403("finance_validation.sod_submitter", "You submitted this value, so you cannot validate it.");
    case "finance_validation_period_required":
    case "finance_validation_content_complete":
      return rule422(
        "finance_validation.content_incomplete",
        "A Finance decision covers all six items: baseline, attribution/counterfactual, calculation, evidence, measurement period and assumptions.",
        "/items",
      );
    case "finance_validation_status_step":
      return rule422("finance_validation.not_queued", "Only a queued item can be decided.", "");
    case "finance_validation_all_items_accepted":
      return rule422(
        "finance_validation.items_not_accepted",
        "An approval needs every item accepted. Reject the value instead, with a note.",
        "/items",
      );
    case "finance_validation_rejection_reason":
      return rule422(
        "finance_validation.rejection_note_required",
        "A rejection needs a note and at least one rejected item.",
        "/note",
      );
    case "finance_validation_amount_shape":
      return rule422(
        "finance_validation.approved_amount_required",
        "Approving a financial value states the approved amount; a non-financial value has none.",
        "/approvedAmount",
      );
    case "benefit_measurement_correction_target":
      return rule422("finance_validation.not_approved", "Only an approved validation can be amended or reversed.", "");
    case "benefit_measurement_already_reversed":
    case "benefit_measurement_one_reversal_key":
      return rule422("finance_validation.already_reversed", "This value is already reversed.", "");
    case "finance_validation_kind_shape":
    case "benefit_measurement_correction_shape":
      return rule422("finance_validation.reason_required", "A correction needs a reason.", "/reason");
    case "benefit_measurement_run_key":
    case "finance_validation_one_per_measurement":
    case "finance_validation_idempotency_key":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "benefit_measurement_decision_present":
    case "benefit_measurement_no_step":
    case "benefit_measurement_no_key":
    case "benefit_measurement_identity_fixed":
    case "benefit_measurement_reversal_amount":
    case "benefit_measurement_correction_period":
    case "benefit_measurement_kind_shape":
    case "benefit_measurement_validated_amount":
    case "benefit_measurement_submitted_stamps":
    case "benefit_measurement_decided_stamps":
    case "finance_validation_subject":
    case "finance_validation_frozen":
    case "finance_validation_decided_stamps":
    case "finance_validation_items_open":
    case "benefit_measurement_input_open":
    case "benefit_evidence_measurement_open":
    case "benefit_plan_value_frozen":
      return problems.internal();
    default:
      return null;
  }
}

/** "<what> % ... %" values of a slice A guard message, e.g. "measure type lower_is_better does not fit the KPI polarity higher_is_better". */
function wordsAfter(error: PgErrorLike, pattern: RegExp): string[] {
  return (pattern.exec(error.message ?? "") ?? []).slice(1).map((v) => v ?? "given");
}

/**
 * P4 slice A, KBE-B part (ADR-0027 §13): the database's last line behind the KPI version, formula, threshold, trajectory
 * and data-quality services, with the ADR's exact codes and English texts (S-11). Null when not one of them.
 */
export function mapP4KpiGuardError(error: PgErrorLike): HttpProblem | null {
  const constraint = error.constraint ?? "";
  switch (constraint) {
    case "kpi_version_complete_when_active":
      return rule422(
        "kpi_version.aggregation_rule_required",
        "A KPI version needs an aggregation rule before it can be activated.",
        "/aggregationRule",
      );
    case "kpi_version_aggregation_fits_nature":
      return rule422(
        "kpi_version.aggregation_not_allowed",
        "The aggregation rule cannot be used for this KPI's value nature. Use sum for flows, last value for stocks, weighted ratio for ratios, none for milestones, or an approved custom formula.",
        "/aggregationRule",
      );
    case "kpi_version_custom_formula_approved":
      return rule422(
        "kpi_version.custom_formula_needs_approval",
        "A custom aggregation formula needs a formula calculation and the business-approval policy.",
        "/aggregationRule",
      );
    case "kpi_version_measure_fits_polarity": {
      const [measureType, polarity] = wordsAfter(error, /measure type (\w+) does not fit the KPI polarity (\w+)/);
      return rule422(
        "kpi_version.measure_mismatch",
        `The measure type ${measureType ?? "given"} does not fit the KPI's polarity ${polarity ?? "given"}.`,
        "/measureType",
      );
    }
    case "kpi_version_band":
      return rule422(
        "kpi_version.band_required",
        "An acceptable-band measure needs a lower and an upper bound, and the lower bound cannot be above the upper bound.",
        "/bandLower",
      );
    case "kpi_version_route_reviewer":
      return rule422(
        "kpi_version.reviewer_required",
        "The review route needs a reviewer role, and the direct-accept route has none.",
        "/reviewerPartyCode",
      );
    case "kpi_version_change_reason":
      return rule422(
        "kpi_version.change_reason_required",
        "A new version of a KPI needs a reason for the change.",
        "/changeReason",
      );
    case "kpi_version_one_draft":
      return problems.duplicate(
        "kpi_version.draft_exists",
        "This KPI already has a draft version. Change or withdraw it first.",
      );
    case "kpi_version_status_step":
    case "kpi_version_frozen":
      return rule422("kpi_version.not_draft", "Only a draft KPI version can be changed, activated or withdrawn.", "");
    case "kpi_version_definition_active":
      return rule422(
        "kpi_version.definition_not_active",
        "Activate the KPI definition before activating one of its versions.",
        "",
      );
    case "kpi_version_approval_required":
      return rule422(
        "kpi_version.approval_required",
        "This KPI version needs an approved business approval before it can be activated.",
        "",
      );
    case "kpi_definition_measure_locked":
      return rule422(
        "kpi_definition.measure_locked",
        "This KPI has a version, so its unit, currency, polarity and frequency can no longer change. Create a new KPI instead.",
        "",
      );
    case "kpi_formula_no_cycle": {
      const [variable] = wordsAfter(
        error,
        /(?:kpi_formula_input: |input )(\w+) (?:would make|makes) a circular reference/,
      );
      return rule422(
        "kpi_formula.circular",
        `The formula would create a circular reference: ${variable ?? "an input"}.`,
        "/formulaInputs",
      );
    }
    case "kpi_rag_threshold_order":
      return rule422("kpi_threshold.order", "The red threshold cannot be below the amber threshold.", "/redThreshold");
    case "target_trajectory_points_required":
      return rule422("target_trajectory.points_required", "An approved trajectory needs at least one point.", "");
    case "target_trajectory_one_draft":
      return problems.duplicate(
        "target_trajectory.draft_exists",
        "This KPI already has a draft trajectory for this scope. Approve or withdraw it first.",
      );
    case "target_trajectory_status_step":
    case "target_trajectory_frozen":
      return rule422("target_trajectory.not_draft", "Only a draft trajectory can be approved or withdrawn.", "");
    case "target_trajectory_approver_not_creator":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "target_trajectory.approver_is_author",
        title: "Forbidden",
        detail: "The person who created this trajectory cannot approve it.",
      });
    case "data_quality_finding_status_step":
      return rule422("data_quality.not_open", "Only an open finding can be resolved or dismissed.", "");
    case "data_quality_finding_resolution":
      return rule422("data_quality.note_required", "Resolving or dismissing a finding needs a note.", "/note");
    default:
      if (
        constraint === "target_trajectory_scope_valid" ||
        constraint === "kpi_actual_scope_valid" ||
        constraint === "rag_override_scope_valid"
      ) {
        const [scopeKind, scopeId] = wordsAfter(error, /scope (\w+) ([0-9a-f-]{36})/);
        return rule422(
          "kpi.scope_invalid",
          `The scope ${scopeKind ?? "given"} ${scopeId ?? ""} is not part of this transformation.`.replace("  ", " "),
          "/scopeId",
        );
      }
      return null;
  }
}

/**
 * P4 slice A, KBE-C part (T-DG4-KBE-C; ADR-0027 §13): the database's last line behind the reporting-period, actual and
 * RAG-override services, with the ADR's codes and English texts (S-11; values from the guard messages where the message
 * carries them). The services check every rule first with the exact parameterized texts. Null when not one of them.
 */
export function mapP4KpiActualGuardError(error: PgErrorLike): HttpProblem | null {
  const constraint = error.constraint ?? "";
  switch (constraint) {
    case "reporting_period_label_key": {
      const [frequency, label] = (/=\([^,]+, ([a-z_]+), ([^)]+)\)/.exec(error.detail ?? "") ?? []).slice(1);
      return problems.duplicate(
        "reporting_period.label_taken",
        `A ${frequency ?? "matching"} reporting period ${label ?? "with this label"} already exists.`,
      );
    }
    case "reporting_period_no_overlap": {
      const [frequency] = wordsAfter(error, /reporting_period: ([a-z_]+) /);
      return rule422(
        "reporting_period.overlap",
        `The period overlaps another ${frequency ?? ""} reporting period.`.replace("  ", " "),
        "/periodStart",
      );
    }
    case "reporting_period_weeks":
      return rule422(
        "reporting_period.weeks_invalid",
        "A week-based period lasts exactly its number of weeks times seven days.",
        "/weekCount",
      );
    case "reporting_period_range":
      return rule422(
        "reporting_period.range_invalid",
        "A reporting period ends on or after its start and lasts at most 367 days.",
        "/periodEnd",
      );
    case "reporting_period_status_step":
      return rule422(
        "reporting_period.status_step",
        "A reporting period moves from scheduled to open to closed, and a closed period stays closed.",
        "",
      );
    case "kpi_actual_period_open": {
      const [label, status] = wordsAfter(error, /reporting period (\S+) is (\w+)/);
      return rule422(
        "kpi_actual.period_not_open",
        `The reporting period ${label} is ${status}. Actuals are entered only for an open period; a closed period is corrected through a restatement.`,
        "/reportingPeriodId",
      );
    }
    case "kpi_actual_period_frequency": {
      const [frequency] = wordsAfter(error, /a (\w+) KPI is reported/);
      return rule422(
        "kpi_actual.period_frequency",
        `A ${frequency} KPI is reported for ${frequency} periods.`,
        "/reportingPeriodId",
      );
    }
    case "kpi_actual_value_currency": {
      const [currency, kpiCurrency] = wordsAfter(error, /currency (\S+) does not match the KPI currency (\S+)/);
      return rule422(
        "kpi_actual.currency_mismatch",
        `The value is in ${currency}, but the KPI is measured in ${kpiCurrency}. Values are never converted.`,
        "/currency",
      );
    }
    case "kpi_actual_value_shape":
      return rule422(
        "kpi_actual.value_shape",
        "Enter the value fields for this KPI, or state why the value is not available.",
        "/value",
      );
    case "kpi_actual_value_active_version":
      return rule422(
        "kpi_actual.no_active_version",
        "This KPI has no active version. Activate a version with its aggregation rule before entering actuals.",
        "",
      );
    case "kpi_actual_review_sod":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "kpi_actual.sod_submitter",
        title: "Forbidden",
        detail: "You submitted this value, so you cannot accept or reject it.",
      });
    case "kpi_actual_reject_reason":
      return rule422("kpi_actual.reject_reason_required", "A rejection needs a reason.", "/reason");
    case "kpi_actual_status_step":
      return rule422("kpi_actual.not_submitted", "Only a submitted value can be accepted or rejected.", "");
    case "kpi_actual_slot_key":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "An actual for this KPI, scope and period was entered at the same time. Read it and add a new value.",
      });
    case "rag_override_one_in_force":
      return problems.duplicate(
        "rag_override.already_in_force",
        "An override is already in force for this KPI, scope and period. Revoke it first.",
      );
    case "rag_override_expiry_window":
      return rule422(
        "rag_override.expiry_invalid",
        "The expiry must be in the future and at most 366 days away.",
        "/expiresAt",
      );
    case "rag_override_status_step":
      return rule422("rag_override.not_active", "Only an override in force can be revoked.", "");
    case "kpi_actual_value_present":
    case "kpi_actual_review_present":
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P4 slice E (ADR-0031 §11): the database last lines of the RAID register and actions (T-DG4-BE-D), then the corrective
 * lines (BE-D2) and the budget and schedule lines (BE-E), each task appending its own. The API returns the same codes
 * and exact English texts first; these mappings only answer a write that reached the guard (S-11). Null when the error
 * is not one of them.
 */
export function mapP4RaidError(error: PgErrorLike): HttpProblem | null {
  const constraint = error.constraint ?? "";
  switch (constraint) {
    // ---- BE-D: RAID entries and actions.
    case "raid_entry_probability_applicable":
      // The CHECK holds both directions. The failing row's fourth column is entry_type ("Failing row contains (id,
      // organization_id, transformation_id, entry_type, …)"): a Risk lacks a Probability, any other type has one.
      return /^Failing row contains \([^,]*, [^,]*, [^,]*, risk,/.test(error.detail ?? "")
        ? rule422("raid.probability_required", "A Risk needs a Probability (High, Medium or Low).", "/probability")
        : rule422(
            "raid.probability_not_applicable",
            "Probability is n/a for Assumption, Issue and Dependency entries; leave it empty.",
            "/probability",
          );
    case "raid_entry_status_transition":
    case "raid_entry_starts_open":
      return rule422(
        "raid.status_transition",
        "A RAID entry moves between Open and In progress; use Close to close it.",
        "",
      );
    case "raid_entry_closed_final":
      return rule422("raid.closed", "This RAID entry is closed and can no longer be changed.", "");
    case "raid_entry_code_key":
      // A concurrent code allocation: retry.
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "raid_entry_type_immutable":
    case "raid_entry_code_format":
    case "raid_entry_closed_complete":
    case "action_item_one_source":
    case "action_item_source_immutable":
      // The API never sends such a write: a programming error.
      return problems.internal();
    // ---- BE-D2: corrective-action cases and rules.
    case "corrective_case_code_key":
      // A concurrent code allocation: retry.
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "corrective_case_status_transition":
    case "corrective_case_starts_open":
      return rule422(
        "corrective_case.status_transition",
        "A corrective action moves between Open and In progress; use Close to close it.",
        "",
      );
    case "corrective_case_closed_final":
      return rule422("corrective_case.closed", "This corrective action is closed and can no longer be changed.", "");
    case "corrective_case_owner_required":
      return rule422("corrective_case.owner_required", "Assign an owner before closing this corrective action.", "");
    case "corrective_case_one_open_key":
      // The API decides this under the correctiveCase lock and names the open case's code; the backstop cannot read it.
      return problems.duplicate(
        "corrective_case.already_open",
        "An open corrective action already exists for this finding: (unknown).",
      );
    case "corrective_action_rule_severity_kpi_only":
      return rule422(
        "corrective_rule.severity_kpi_only",
        "A severity applies to KPI deviations only, and a KPI deviation rule needs one.",
        "/minKpiRag",
      );
    case "corrective_action_rule_persistence_series_only":
      return rule422(
        "corrective_rule.persistence_series_only",
        "A failed check is one event: its persistence is 1 cycle.",
        "/persistenceCycles",
      );
    case "corrective_action_rule_source_key":
      return problems.duplicate(
        "corrective_rule.exists",
        "A rule for this source already exists in this transformation; update it instead.",
      );
    case "corrective_case_source_fields":
    case "corrective_case_created_source":
    case "corrective_case_source_immutable":
    case "corrective_case_one_per_check_key":
    case "corrective_case_closed_complete":
    case "corrective_case_follow_up_calendar":
    case "corrective_action_rule_source_immutable":
    case "corrective_signal_event_key":
    case "corrective_signal_outcome_case":
    case "corrective_signal_period_range":
    case "corrective_signal_rag_kpi_only":
      // The API never sends such a write: a programming error.
      return problems.internal();
    // ---- BE-E: budget lines and initiative durations (ADR-0031 §7-§8, §11).
    case "budget_line_archived_frozen":
      return rule422("budget_line.archived", "This budget line is archived and can no longer be changed.", "");
    case "budget_line_active_key":
      return problems.duplicate(
        "budget_line.duplicate",
        "An active budget line with this label and month already exists for the initiative.",
      );
    case "budget_line_period_month_check":
      return rule422(
        "budget_line.period_invalid",
        "The month must be given as its first day (YYYY-MM-01).",
        "/periodMonth",
      );
    case "initiative_schedule_initiative_key":
      return problems.duplicate(
        "initiative_schedule.exists",
        "This initiative already has a planned duration; update it instead.",
      );
    case "budget_line_currency_locked":
    case "initiative_schedule_initiative_immutable":
      // The API never sends such a write: a programming error.
      return problems.internal();
    default:
      return null;
  }
}

/**
 * Maps a P2 database guard or template-constraint error to a problem, or null when the error is not one of them (the
 * generic mapping in hooks.ts then applies).
 */
export function mapDatabaseGuardError(error: PgErrorLike): HttpProblem | null {
  const code = error.code;
  if (code === undefined || !SQLSTATE.test(code)) return null;
  const constraint = error.constraint ?? "";

  if (constraint.endsWith("_version_step"))
    return new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "version_conflict",
      title: "Version conflict",
      detail: "The record was changed by someone else. Review the current version and re-apply your change.",
    });
  const p4 = mapP4GuardError(error);
  if (p4 !== null) return p4;
  const p4BenefitRegister = mapP4BenefitRegisterError(error);
  if (p4BenefitRegister !== null) return p4BenefitRegister;
  const p4BenefitD2 = mapP4BenefitD2Error(error);
  if (p4BenefitD2 !== null) return p4BenefitD2;
  const p4BenefitValue = mapP4BenefitValueError(error);
  if (p4BenefitValue !== null) return p4BenefitValue;

  const p4Kpi = mapP4KpiGuardError(error);
  if (p4Kpi !== null) return p4Kpi;
  const p4KpiActual = mapP4KpiActualGuardError(error);
  if (p4KpiActual !== null) return p4KpiActual;
  const p4Raid = mapP4RaidError(error);
  if (p4Raid !== null) return p4Raid;
  if (constraint === "gate_decision_not_submitter")
    return new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "gate.submitter_cannot_decide",
      title: "Forbidden",
      detail: "The person who submitted the gate cannot decide it (separation of duties).",
    });
  if (constraint === "evidence_review_separation")
    return new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "evidence.reviewer_is_author",
      title: "Forbidden",
      detail: "Evidence is reviewed by someone other than the person who added it or supplied its current content.",
    });
  if (constraint === "gate_decision_current_submission")
    return new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "gate.submission_superseded",
      title: "Version conflict",
      detail: "Only the current pending submission can be decided; this one was superseded or already decided.",
    });
  if (constraint === "initiative_status_transition")
    return new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.invalidTransition,
      code: "invalid_transition",
      title: "Invalid transition",
      detail: "This status change is not allowed for the initiative in its current status.",
    });
  if (constraint === "dependency_acyclic") return new DependencyCycleProblem(cycleOfDatabaseError(error));
  if (constraint === "scoring_weight_set_total") {
    const got = /\(got ([0-9.-]+) over/.exec(error.message ?? "")?.[1];
    const detail = got !== undefined ? `Weights must total 100% (got ${got}%)` : "Weights must total 100%";
    return new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "prioritization.weights_total",
      title: "Business rule violated",
      detail,
      errors: [{ pointer: "/weights", code: "prioritization.weights_total", message: detail }],
    });
  }
  const sod = SEPARATION_OF_DUTIES.find((r) => constraint.endsWith(r.suffix));
  if (sod !== undefined)
    return new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: sod.code,
      title: "Forbidden",
      detail: sod.detail,
    });
  if (
    PROGRAMMING_ERROR_CONSTRAINTS.has(constraint) ||
    PROGRAMMING_ERROR_SUFFIXES.some((s) => constraint.endsWith(s)) ||
    // p2_append_only raises insufficient_privilege without a constraint name.
    (code === "42501" && constraint === "")
  )
    return problems.internal();

  const rule = BUSINESS_RULES.get(constraint);
  if (rule !== undefined)
    return new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: rule.code,
      title: "Business rule violated",
      detail: rule.detail,
      errors: [{ pointer: rule.pointer, code: `validation.${rule.code}`, message: rule.detail }],
    });

  switch (code) {
    case "23502": {
      // not_null_violation: a template's required column (e.g. T02 target_date, T03 dimension_code).
      const pointer = error.column ? pointerOfColumn(error.column) : "";
      return new HttpProblem({
        status: 422,
        type: PROBLEM_TYPES.validation,
        code: "validation.required",
        title: "Business rule violated",
        detail: "A required value is missing.",
        errors: [{ pointer, code: "validation.required", message: "A required value is missing." }],
      });
    }
    case "23514": {
      // check_violation of a template column: PostgreSQL names column CHECKs `<table>_<column>_check`.
      const table = error.table ?? "";
      const column =
        table !== "" && constraint.startsWith(`${table}_`) && constraint.endsWith("_check")
          ? constraint.slice(table.length + 1, -"_check".length)
          : "";
      const pointer = column !== "" ? pointerOfColumn(column) : (P3_CHECK_POINTERS.get(constraint) ?? "");
      return new HttpProblem({
        status: 422,
        type: PROBLEM_TYPES.validation,
        code: "validation.constraint",
        title: "Business rule violated",
        detail: "The change violates a data rule.",
        errors: [{ pointer, code: "validation.constraint", message: constraint || "check_violation" }],
      });
    }
    case "23503":
      if (constraint.endsWith("_record_ref"))
        return new HttpProblem({
          status: 422,
          type: PROBLEM_TYPES.validation,
          code: "validation.reference",
          title: "Business rule violated",
          detail: "The linked record does not exist in this transformation.",
          errors: [
            { pointer: "/recordId", code: "validation.reference", message: "No such record in this transformation." },
          ],
        });
      return null;
    case "22021": // character_not_in_repertoire (U+0000 in text; F-DG2-231)
    case "22P05": // untranslatable_character (a character the server encoding cannot hold; F-DG2-231)
      // The column is not reported for these errors, so the pointer is the whole request; the central request check
      // (validation.ts, assertNoInvalidCharacters) normally answers first with the exact field pointer.
      return invalidCharacterProblem("");
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow (e.g. 2026-02-30)
      return problems.badRequest("validation.date", "A date is not a valid calendar date.");
    default:
      return null;
  }
}
