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
import { allocationExceedsText } from "@mth/shared/schemas";
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
      // T-DG4-BE-R1: createCorrectiveCase decides this itself (INSERT ... ON CONFLICT DO NOTHING under the
      // correctiveCase lock) and answers 409 corrective_case.already_open with the open case's real code, so the
      // refusal has exactly one path. No API write can reach this index otherwise (the source fields are immutable and
      // a PATCH never reopens a case): reaching it is a programming error, never a refusal without its code.
      return problems.internal();
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

// ---- P4 slices F and G block (ADR-0033 §10, ADR-0034 §12). Each slice F/G task appends its own lines.
// BE-I (T-DG4-BE-I; p4-work-split §F+G FG.4): performance areas, links and cycles, BAU handovers. The API checks every
// one of these first (under lock class bauHandover where it matters); these are the database's last line (S-11).
const handoverRule = (code: string, detail: string, pointer = ""): HttpProblem => rule422(code, detail, pointer);
const handoverInvalidTransition = (code: string, detail: string): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.invalidTransition,
    code,
    title: "Invalid transition",
    detail,
    errors: [{ pointer: "", code, message: detail }],
  });
const retryConflict = (): HttpProblem =>
  new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: "The record was changed by someone else. Review the current version and re-apply your change.",
  });

/**
 * P4 slice G, BE-I lines (ADR-0034 §4, §5, §12): performance areas, links, cycles and BAU handovers. Null when the
 * error is not one of them.
 */
export function mapP4SustainmentAreaError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "performance_area_retired_final":
      return handoverRule("performance_area.retired", "This performance area is retired and can no longer be changed.");
    case "performance_area_transition":
    case "performance_area_cycle_step":
      return handoverInvalidTransition(
        "performance_area.not_reopenable",
        "Only a performance area in BAU can be reopened.",
      );
    case "performance_area_link_active_key":
      return problems.duplicate(
        "performance_area_link.exists",
        "This KPI or benefit is already linked to the performance area.",
      );
    case "performance_area_link_removed_final":
      return problems.invalidTransition("This link is removed; a removed link is final.");
    case "performance_area_code_key":
    case "bau_handover_code_key":
    case "bau_handover_evidence_key":
      // A concurrent code allocation or evidence link: retry.
      return retryConflict();
    case "bau_handover_open_key":
    case "bau_handover_accepted_key":
      return problems.duplicate(
        "bau_handover.exists",
        "This performance area already has a handover in progress for this cycle.",
      );
    case "bau_handover_area_open":
      return handoverRule(
        "bau_handover.area_not_open",
        "A handover is prepared for an establishing or reopened performance area.",
        "/performanceAreaId",
      );
    case "bau_handover_accepted_final":
      return handoverRule("bau_handover.accepted_final", "An accepted handover is final and cannot be changed.");
    case "bau_handover_content_frozen":
    case "bau_handover_evidence_editable":
      return handoverRule("bau_handover.frozen", "A submitted handover can only be accepted or returned.");
    case "bau_handover_transition": {
      const [from, to] = (/: ([a-z]+) -> ([a-z]+) is not a legal transition/.exec(error.message ?? "") ?? []).slice(1);
      return handoverInvalidTransition(
        "bau_handover.status_transition",
        `This handover cannot move from ${from ?? "its status"} to ${to ?? "that status"}.`,
      );
    }
    case "bau_handover_controls_required":
      return new HttpProblem({
        status: 422,
        type: PROBLEM_TYPES.validation,
        code: "bau_handover.incomplete",
        title: "Business rule violated",
        detail: "The BAU handover is incomplete. Missing: controls.",
        errors: [{ pointer: "/controlIds", code: "bau_handover.incomplete", message: "controls" }],
      });
    case "bau_handover_evidence_required":
      return new HttpProblem({
        status: 422,
        type: PROBLEM_TYPES.validation,
        code: "bau_handover.incomplete",
        title: "Business rule violated",
        detail: "The BAU handover is incomplete. Missing: evidence.",
        errors: [{ pointer: "/evidenceIds", code: "bau_handover.incomplete", message: "evidence" }],
      });
    case "bau_handover_accepted_complete":
    case "bau_handover_returned_stamps":
      // accepted_by / returned_by must be the receiving owner (probe HO04).
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "bau_handover.not_receiving_owner",
        title: "Forbidden",
        detail: "Only the receiving owner can accept or return this handover.",
      });
    case "performance_area_starts_establishing":
    case "performance_area_code_immutable":
    case "performance_area_bau_handover_accepted":
    case "performance_area_reopen_keeps_handover":
    case "performance_area_bau_complete":
    case "performance_area_retired_complete":
    case "performance_area_cycle_present":
    case "performance_area_cycle_first":
    case "performance_area_cycle_prior_stamps":
    case "performance_area_link_starts_active":
    case "performance_area_link_identity":
    case "performance_area_link_target":
    case "performance_area_link_removed_complete":
    case "bau_handover_starts_draft":
    case "bau_handover_identity":
    case "bau_handover_current_cycle":
    case "bau_handover_submitted_stamps":
    case "bau_handover_content_complete":
      // The API never sends such a write: a programming error.
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P4 slice G, BE-I2 lines (ADR-0034 §6, §8, §12): controls, control checks, sustainment reviews, the CI backlog and
 * lessons. The API answers the same codes and exact English texts first; these only answer a write that reached the
 * guard (S-11). Null when the error is not one of them.
 */
export function mapP4SustainmentOperationsError(error: PgErrorLike): HttpProblem | null {
  const message = error.message ?? "";
  const finalStatus = (/: an? ([a-z_]+) (?:check|review|item) is final/.exec(message) ?? [])[1];
  const edge = (/: ([a-z_]+) -> ([a-z_]+) is not a legal transition/.exec(message) ?? []).slice(1);
  switch (error.constraint ?? "") {
    case "control_retired_final":
      return handoverRule("control.retired", "This control is retired and can no longer be changed.");
    case "control_check_final":
      return handoverRule(
        "control_check.final",
        `This control check is ${finalStatus ?? "recorded"} and can no longer be changed.`,
      );
    case "control_check_performed_complete":
      return problems.badRequest(
        "control_check.result_note_required",
        "A failed control check needs a result note.",
        "/resultNote",
      );
    case "sustainment_review_final":
      return handoverRule(
        "sustainment_review.final",
        `This review is ${finalStatus ?? "closed"} and can no longer be changed.`,
      );
    case "improvement_item_final":
      return handoverRule(
        "improvement_item.final",
        `This improvement item is ${finalStatus ?? "closed"} and can no longer be changed.`,
      );
    case "improvement_item_transition":
      return handoverRule(
        "improvement_item.status_transition",
        `This improvement item cannot move from ${edge[0] ?? "its status"} to ${edge[1] ?? "that status"}.`,
      );
    case "improvement_item_resolved_complete":
      return problems.badRequest(
        "improvement_item.resolution_note_required",
        "Record a resolution note before closing the item.",
        "/resolutionNote",
      );
    case "lesson_archived_final":
      return handoverRule("lesson.archived", "This lesson is archived and can no longer be changed.");
    case "lesson_transition":
      return handoverRule(
        "lesson.status_transition",
        `This lesson cannot move from ${edge[0] ?? "its status"} to ${edge[1] ?? "that status"}.`,
      );
    case "control_code_key":
    case "improvement_item_code_key":
    case "lesson_code_key":
      // A concurrent code allocation: retry.
      return retryConflict();
    case "control_check_due_key":
    case "sustainment_review_due_key":
      // Only the worker scans insert these (insert-if-absent); an API write never reaches them.
      return retryConflict();
    case "control_starts_active":
    case "control_identity":
    case "control_retired_complete":
    case "control_check_starts_due":
    case "control_check_control_active":
    case "control_check_identity":
    case "control_check_created_source":
    case "sustainment_review_starts_due":
    case "sustainment_review_area_bau":
    case "sustainment_review_decision_approved":
    case "sustainment_review_identity":
    case "sustainment_review_subject":
    case "sustainment_review_created_source":
    case "sustainment_review_done_complete":
    case "improvement_item_starts_open":
    case "improvement_item_source_immutable":
    case "improvement_item_source_fields":
    case "lesson_starts_draft":
    case "lesson_code_immutable":
    case "lesson_published_complete":
    case "lesson_archived_complete":
    case "lesson_tags_valid":
      // The API never sends such a write: a programming error.
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P4 slice G, BE-J lines (T-DG4-BE-J; ADR-0034 §1, §3, §7, §12): the initiative delivery and adoption stamps,
 * transition decisions and closure records. The API answers the same codes and exact English texts first (closures
 * under lock class closure); these only answer a write that reached the guard (S-11). Null when the error is
 * not one of them.
 */
export function mapP4SustainmentClosureError(error: PgErrorLike): HttpProblem | null {
  const message = error.message ?? "";
  const finalStatus = (/: an? ([a-z_]+) decision is final/.exec(message) ?? [])[1];
  switch (error.constraint ?? "") {
    case "transition_decision_live_key":
      return problems.duplicate(
        "transition_decision.exists",
        "This benefit already has a transition decision in progress or approved.",
      );
    case "transition_decision_final":
      return handoverRule(
        "transition_decision.final",
        `This transition decision is ${finalStatus ?? "decided"} and can no longer be changed.`,
      );
    case "transition_decision_content_frozen":
      return handoverRule("transition_decision.frozen", "A submitted transition decision cannot be edited.");
    case "transition_decision_monitoring_dates":
      return handoverRule(
        "transition_decision.monitoring_after_end",
        "The first monitoring date must be on or before the expected realization end.",
        "/firstMonitoringDate",
      );
    case "closure_record_initiative_key":
      return problems.duplicate("closure.already_closed", "This initiative is already closed.");
    case "closure_record_transformation_key":
      return problems.duplicate("closure.already_closed", "This transformation is already closed.");
    case "closure_record_initiative_completed":
      return handoverInvalidTransition("closure.delivery_not_complete", "Initiative delivery is not complete.");
    case "closure_record_g6_approved":
      return handoverInvalidTransition(
        "closure.g6_not_approved",
        "Closure requires the G6 (Sustain) business approval.",
      );
    case "transition_decision_code_key":
      // A concurrent code allocation: retry.
      return retryConflict();
    case "transition_decision_starts_draft":
    case "transition_decision_transition":
    case "transition_decision_identity":
    case "transition_decision_decided_complete":
    case "transition_decision_frequency_valid":
    case "closure_record_subject":
    case "closure_record_closer_is_creator":
    case "transformation_closure_recorded":
    case "initiative_delivery_completed_recorded":
    case "initiative_delivery_completed_once":
    case "initiative_delivery_completed_stamps":
    case "initiative_adoption_status_stamps":
    case "initiative_adoption_status_valid":
      // The API never sends such a write: a programming error.
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P4 slices F and G (ADR-0033 §10, ADR-0034 §12): the database last lines of the adoption and sustainment tables, each
 * task appending its own lines to this block (p4-work-split §F+G). The API returns the same codes and exact English
 * texts first; these mappings only answer a write that reached the guard (S-11). Null when the error is not one of them.
 */
export function mapP4AdoptionSustainmentError(error: PgErrorLike): HttpProblem | null {
  const constraint = error.constraint ?? "";
  const message = error.message ?? "";
  switch (constraint) {
    // ---- BE-H (T-DG4-BE-H): T13 stakeholder groups, champions, interventions, involvement, champion constraints.
    case "stakeholder_group_name_key":
      return problems.duplicate(
        "stakeholder_group.name_taken",
        "A stakeholder group with this name already exists in this transformation.",
      );
    case "stakeholder_group_archived_final":
      return rule422(
        "stakeholder_group.archived",
        "This stakeholder group is archived and can no longer be changed.",
        "",
      );
    case "stakeholder_group_kpi_fkey":
      return rule422(
        "stakeholder_group.kpi_invalid",
        "The adoption KPI must be a KPI of this transformation.",
        "/adoptionKpiDefinitionId",
      );
    case "stakeholder_champion_active_key":
      return problems.duplicate("stakeholder_champion.exists", "This person is already a champion of this group.");
    case "stakeholder_champion_removed_final":
      return problems.invalidTransition("This champion is already removed.");
    case "adoption_intervention_final": {
      const status = /a (done|cancelled) intervention is final/.exec(message)?.[1] ?? "closed";
      return rule422("adoption_intervention.final", `This intervention is ${status} and can no longer be changed.`, "");
    }
    case "adoption_intervention_transition": {
      const m = /: ([a-z_]+) -> ([a-z_]+) is not a legal transition/.exec(message);
      return rule422(
        "adoption_intervention.status_transition",
        `This intervention cannot move from ${m?.[1] ?? "its status"} to ${m?.[2] ?? "this status"}.`,
        "/status",
      );
    }
    case "adoption_intervention_owner_required":
      return rule422(
        "adoption_intervention.owner_required",
        "Assign an owner before completing this intervention.",
        "",
      );
    case "adoption_intervention_done_complete":
      return rule422(
        "adoption_intervention.outcome_required",
        "Record the outcome before completing or cancelling the intervention.",
        "/outcomeNote",
      );
    case "stakeholder_group_code_key":
    case "adoption_intervention_code_key":
      // A concurrent code allocation: retry.
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "stakeholder_involvement_withdraws_key":
      return rule422("stakeholder_involvement.already_withdrawn", "This involvement record is already withdrawn.", "");
    case "stakeholder_involvement_design_decision":
    case "stakeholder_involvement_decision_fkey":
      return rule422(
        "stakeholder_involvement.target_invalid",
        "Involvement is recorded on a design workshop or a T04 design decision of this transformation.",
        "/decisionId",
      );
    case "stakeholder_involvement_workshop_fkey":
      return rule422(
        "stakeholder_involvement.target_invalid",
        "Involvement is recorded on a design workshop or a T04 design decision of this transformation.",
        "/workshopId",
      );
    case "champion_constraint_raised_by_champion":
      return forbidden403(
        "champion_constraint.not_champion",
        "Only an active champion of this group can raise a constraint.",
      );
    case "champion_constraint_design_decision":
    case "champion_constraint_decision_fkey":
      return rule422(
        "champion_constraint.decision_invalid",
        "A constraint links to a T04 design decision of this transformation.",
        "/decisionId",
      );
    case "champion_constraint_final": {
      const status = /a (addressed|withdrawn) constraint is final/.exec(message)?.[1] ?? "closed";
      return rule422("champion_constraint.final", `This constraint is ${status} and can no longer be changed.`, "");
    }
    // ---- KBE-F (T-DG4-KBE-F): adoption metric links (ADR-0033 §3, §10). The service answers these before any write;
    // these lines answer a write that reached the database guard (a concurrent attachment, a vanished reference).
    case "adoption_metric_link_active_key":
      return problems.duplicate("adoption_metric_link.exists", "This indicator is already attached to this target.");
    case "adoption_metric_link_removed_final":
      return problems.invalidTransition("This metric link is already removed.");
    case "adoption_metric_link_kpi_fkey":
      return rule422("validation.reference", "No such record in this transformation.", "/kpiDefinitionId");
    case "adoption_metric_link_outcome_fkey":
    case "adoption_metric_link_initiative_fkey":
    case "adoption_metric_link_group_fkey":
      return rule422("validation.reference", "No such record in this transformation.", "/targetId");
    case "adoption_metric_link_kpi_matches_source":
    case "adoption_metric_link_starts_active":
    case "adoption_metric_link_identity":
    case "adoption_metric_link_target":
    case "adoption_metric_link_removed_complete":
      // The API never sends such a write: a programming error.
      return problems.internal();
    case "stakeholder_group_starts_active":
    case "stakeholder_group_code_immutable":
    case "stakeholder_group_archive_complete":
    case "stakeholder_group_intervention_types_valid":
    case "stakeholder_group_intervention_types_distinct":
    case "stakeholder_champion_starts_active":
    case "stakeholder_champion_identity":
    case "stakeholder_champion_same_org":
    case "stakeholder_champion_removed_complete":
    case "adoption_intervention_starts_planned":
    case "adoption_intervention_origin_shape":
    case "adoption_intervention_origin_immutable":
    case "adoption_intervention_evaluation_matches":
    case "adoption_intervention_trigger_key":
    case "stakeholder_involvement_target":
    case "stakeholder_involvement_withdraw_matches":
    case "champion_constraint_starts_open":
    case "champion_constraint_identity":
    case "champion_constraint_resolved_complete":
      // The API never sends such a write: a programming error.
      return problems.internal();
    // ---- BE-H2 (T-DG4-BE-H2): feedback and assessment forms, invitations, assessment and training records.
    case "assessment_form_retired_final":
    case "assessment_form_version_form_open":
      return rule422("assessment_form.retired", "This form is retired and can no longer be changed.", "");
    case "assessment_form_transition": {
      const m = /: ([a-z_]+) -> ([a-z_]+) is not a legal transition/.exec(message);
      return rule422(
        "assessment_form.status_transition",
        `This form cannot move from ${m?.[1] ?? "its status"} to ${m?.[2] ?? "this status"}.`,
        "",
      );
    }
    case "assessment_form_version_schema_valid":
      return new HttpProblem({
        status: 400,
        type: PROBLEM_TYPES.validation,
        code: "assessment_form.schema_invalid",
        title: "Validation failed",
        detail: "The form is not valid: the questions do not follow the form rules.",
        errors: [
          {
            pointer: "/schema/questions",
            code: "assessment_form.schema_invalid",
            message: "The form is not valid: the questions do not follow the form rules.",
          },
        ],
      });
    case "assessment_invitation_form_published":
    case "assessment_record_form_published":
      return rule422("assessment_form.not_published", "Only a published form takes invitations and responses.", "");
    case "assessment_invitation_open_key":
      return problems.duplicate(
        "assessment_invitation.exists",
        "This person already has an open invitation to this form.",
      );
    case "assessment_invitation_final": {
      const status = /a (responded|cancelled) invitation is final/.exec(message)?.[1] ?? "closed";
      return rule422("assessment_invitation.final", `This invitation is ${status} and can no longer be changed.`, "");
    }
    case "assessment_record_invitation_key":
      // A second response to the same invitation: the invitation is already answered.
      return rule422("assessment_invitation.final", "This invitation is responded and can no longer be changed.", "");
    case "assessment_record_invitation_matches":
      return forbidden403("assessment_record.not_invited", "You are not invited to answer this form.");
    case "assessment_record_withdrawn_final":
      return rule422("assessment_record.withdrawn", "This response is withdrawn and can no longer be changed.", "");
    case "assessment_record_transition": {
      const m = /: ([a-z_]+) -> ([a-z_]+) is not a legal transition/.exec(message);
      return rule422(
        "assessment_record.status_transition",
        `This response cannot move from ${m?.[1] ?? "its status"} to ${m?.[2] ?? "this status"}.`,
        "",
      );
    }
    case "training_record_final": {
      const status = /a (completed|no_show|withdrawn) record is final/.exec(message)?.[1] ?? "closed";
      return rule422("training_record.final", `This training record is ${status} and can no longer be changed.`, "");
    }
    case "training_record_intervention_fkey":
      // The linked intervention is not one of this transformation (the service checks first; a race backstop).
      return rule422(
        "validation.reference",
        "The linked record does not exist in this transformation.",
        "/interventionId",
      );
    case "training_record_intervention_training":
      return rule422(
        "training_record.intervention_not_training",
        "Only a training intervention can be linked to a training record.",
        "/interventionId",
      );
    case "training_record_completed_complete":
      return problems.validation([
        { pointer: "/completedOn", code: "validation.required", message: "validation.required" },
      ]);
    case "assessment_form_starts_draft":
    case "assessment_form_kind_immutable":
    case "assessment_form_version_no_step":
    case "assessment_form_published_version":
    case "assessment_form_published_complete":
    case "assessment_form_retired_complete":
    case "assessment_invitation_starts_open":
    case "assessment_invitation_identity":
    case "assessment_record_starts_submitted":
    case "assessment_record_kind_matches_form":
    case "assessment_record_immutable":
    case "assessment_record_respondent_is_creator":
    case "assessment_record_proficiency_shape":
    case "assessment_record_reviewed_complete":
    case "assessment_record_withdrawn_complete":
    case "training_record_identity":
    case "training_record_participant":
      // The API never sends such a write: a programming error.
      return problems.internal();
    default:
      return null;
  }
}

// P4 slice D block (ADR-0032 §11 "Database last-line mappings"). BE-F's forum, series and meeting lines come first; BE-G
// appends its T16, escalation and blocker lines and BE-F2 its agenda, attendance, minutes and output lines after them.
// The services return the same codes and English texts before any write; these answer a write that reached the guard.

/** The "<from> -> <to>" of a meeting_status_transition message ("meeting <id>: a -> b is not a legal transition"). */
function meetingEdgeOf(message: string | undefined): [string, string] {
  const m = /: ([a-z_]+) -> ([a-z_]+) is not a legal transition/.exec(message ?? "");
  return m ? [m[1]!, m[2]!] : ["its status", "the requested status"];
}

/** The status word of a "... a <status> meeting is final" / "the meeting is <status> ..." message. */
function meetingStatusOf(message: string | undefined): string {
  const m = /(?:a ([a-z_]+) meeting is final|the meeting is ([a-z_]+) and)/.exec(message ?? "");
  return m?.[1] ?? m?.[2] ?? "closed";
}

/**
 * P4 slice D (ADR-0032 §11): the database last lines of forums, participants, meeting series and meetings (T-DG4-BE-F).
 * Runs before the generic `*_version_step` rule, because `meeting_series_rule_version_step` is a programming error
 * (500), not a version conflict. Null when the error is not one of them.
 */
export function mapP4GovernanceMeetingError(error: PgErrorLike): HttpProblem | null {
  const constraint = error.constraint ?? "";
  if (constraint.endsWith("_meeting_frozen"))
    return rule422(
      "meeting.frozen",
      `This meeting is ${meetingStatusOf(error.message)}; its records can no longer be changed.`,
      "",
    );
  switch (constraint) {
    // ---- BE-F: forums, participants, meeting series and meetings.
    case "forum_archived_final":
      return rule422("forum.archived", "This forum is archived and can no longer be changed.", "");
    case "forum_participant_parties_known":
      // The guard cannot name the party; the API names it before the write.
      return rule422("forum.party_unknown", "A listed party is not a known governance role.", "/participantParties");
    case "forum_output_kinds_valid":
      return rule422(
        "forum.output_kind_invalid",
        "Outputs are chosen from: decisions, unblockers, benefit view, integrated status, decision log, milestones, actions, RAID, test, evidence, recommendation, benefit evidence, forecast, corrective action.",
        "/outputKinds",
      );
    case "forum_publish_outputs_subset":
      return rule422(
        "forum.publish_output_not_listed",
        "A required publication output must be one of this forum's outputs.",
        "/publishRequiresAnyOutput",
      );
    case "forum_participant_active_user_key":
    case "forum_participant_active_group_key":
      return problems.duplicate(
        "forum_participant.exists",
        "This person or group is already a participant of the forum.",
      );
    case "forum_participant_removed_final":
      return rule422("forum_participant.removed", "This participant was removed and can no longer be changed.", "");
    case "meeting_series_one_active_key":
      return problems.duplicate(
        "meeting_series.exists",
        "This forum already has an active meeting series; change it instead.",
      );
    case "meeting_series_ended_final":
      return rule422("meeting_series.ended", "This meeting series has ended and can no longer be changed.", "");
    case "meeting_series_rule_shape":
      return new HttpProblem({
        status: 400,
        type: PROBLEM_TYPES.validation,
        code: "meeting_series.rule_invalid",
        title: "Invalid request",
        detail:
          "A weekly series needs its weekdays, a monthly series a day of the month (1–28), and a daily series neither.",
        errors: [
          {
            pointer: "/weekdays",
            code: "meeting_series.rule_invalid",
            message:
              "A weekly series needs its weekdays, a monthly series a day of the month (1–28), and a daily series neither.",
          },
        ],
      });
    case "meeting_status_transition": {
      const [from, to] = meetingEdgeOf(error.message);
      return rule422("meeting.status_transition", `This meeting cannot move from ${from} to ${to}.`, "");
    }
    case "meeting_final":
      return rule422(
        "meeting.final",
        `This meeting is ${meetingStatusOf(error.message)} and can no longer be changed.`,
        "",
      );
    case "forum_template_immutable":
    case "forum_participant_identity":
    case "forum_participant_starts_active":
    case "forum_participant_same_org":
    case "forum_participant_one_target":
    case "forum_participant_removed_complete":
    case "meeting_series_rule_version_step":
    case "meeting_series_author_required":
    case "meeting_series_starts_active":
    case "meeting_series_forum_immutable":
    case "meeting_series_dates":
    case "meeting_series_ended_complete":
    case "meeting_starts_scheduled":
    case "meeting_regenerate_future_only":
    case "meeting_created_source":
    case "meeting_series_fields":
    case "meeting_minutes_required":
    case "meeting_cancelled_complete":
    case "meeting_cutoff_known_or_reason":
    case "meeting_times":
      // The API never sends such a write: a programming error.
      return problems.internal();
    // ---- BE-G: the T16 log, decision-SLA escalations, blocker statuses and escalation rules (ADR-0032 §11). The API
    // refuses each of these before its write; these are the last lines (a race or a programming error).
    case "decision_one_open_blocker_ask":
      return problems.duplicate(
        "executive_decision.blocker_ask_open",
        "An open executive ask already exists for this blocker: see the T16 log.",
      );
    case "decision_ask_complete":
      return new HttpProblem({
        status: 400,
        type: PROBLEM_TYPES.validation,
        code: "executive_decision.field_required",
        title: "Invalid request",
        detail: "Decision, why now, recommendation, impact of delay, decision owner and required date are required.",
        errors: [
          {
            pointer: "",
            code: "executive_decision.field_required",
            message:
              "Decision, why now, recommendation, impact of delay, decision owner and required date are required.",
          },
        ],
      });
    case "decision_ask_options":
      return new HttpProblem({
        status: 400,
        type: PROBLEM_TYPES.validation,
        code: "executive_decision.options_too_few",
        title: "Invalid request",
        detail: "An executive ask states at least two options.",
        errors: [
          {
            pointer: "/options",
            code: "executive_decision.options_too_few",
            message: "An executive ask states at least two options.",
          },
        ],
      });
    case "decision_ask_outcome_recorded":
      return new HttpProblem({
        status: 400,
        type: PROBLEM_TYPES.validation,
        code: "executive_decision.field_required",
        title: "Invalid request",
        detail: "Outcome is required.",
        errors: [
          { pointer: "/outcomeText", code: "executive_decision.field_required", message: "Outcome is required." },
        ],
      });
    case "decision_code_key":
      // A concurrent DEC-nn allocation (the counter row serializes it; this is the second line): retry.
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "governance_escalation_rule_kind_key":
      return problems.duplicate(
        "escalation_rule.exists",
        "A rule of this kind already exists in this transformation; update it instead.",
      );
    case "governance_escalation_rule_shape":
    case "governance_escalation_rule_red_cycles_check":
      return rule422(
        "escalation_rule.shape",
        "A decision-SLA rule takes an escalation chain only; a blocker rule takes red cycles (2–12), a deadline in working days and an owner role.",
        "",
      );
    case "blocker_status_once_per_cycle":
      return problems.duplicate("blocker_status.exists", "A RAG for this blocker is already recorded in this meeting.");
    case "blocker_status_meeting_in_session":
      return rule422(
        "meeting.not_in_session",
        "Decisions and blocker status are recorded while the meeting is in session or held.",
        "",
      );
    case "blocker_status_record_ref":
      return rule422(
        "blocker_status.record_not_found",
        "The blocker does not exist in this transformation.",
        "/sourceRecordId",
      );
    case "decision_ask_executive_only":
    case "decision_ask_columns":
    case "decision_ask_source":
    case "decision_ask_sla_known_or_reason":
    case "decision_ask_origin_immutable":
    case "decision_blocker_pair":
    case "decision_blocker_ref":
    case "decision_escalation_once":
    case "decision_escalation_expired":
    case "decision_escalation_target":
    case "decision_escalation_party_error":
    case "decision_escalation_open_ask":
    case "decision_escalation_level_step":
    case "blocker_status_cycle_of_meeting":
    case "governance_escalation_rule_kind_immutable":
      // The API never sends such a write (decision escalations are written by the worker only): a programming error.
      return problems.internal();
    // ---- BE-F2 (T-DG4-BE-F2): agenda items, attendance, minutes, outputs and action links (ADR-0032 §11). The
    // services answer each of these before their write, with the same codes and texts; these are the last lines.
    case "agenda_item_quorum_met": {
      const q = /quorum (\d+) not met \((\d+) counted present\)/.exec(error.message ?? "");
      return problems.businessRule(
        "meeting.quorum_not_met",
        `This meeting has not reached its quorum: ${q?.[2] ?? "fewer"} of ${q?.[1] ?? "its quorum"} counted present. Decisions cannot be recorded below quorum.`,
      );
    }
    case "agenda_item_meeting_not_in_session":
      return problems.businessRule(
        "meeting.not_in_session",
        "Decisions and blocker status are recorded while the meeting is in session or held.",
      );
    case "agenda_item_executive_asks_only":
      return problems.businessRule(
        "agenda_item.executive_asks_only",
        "Escalate decisions, not status: this forum's agenda takes executive asks only.",
      );
    case "agenda_item_published_ask_linked":
      // The guard cannot list the missing elements; the API lists them before the write.
      return rule422(
        "agenda_item.executive_ask_incomplete",
        "An executive agenda item must state the decision required, why now, options, recommendation, impact of delay, decision owner and required date before it is published. Missing: decision required.",
        "/brief",
      );
    case "agenda_item_final": {
      const status = /a ([a-z_]+) item is final/.exec(error.message ?? "")?.[1] ?? "closed";
      return problems.businessRule("agenda_item.final", `This agenda item is ${status} and can no longer be changed.`);
    }
    case "agenda_item_published_frozen":
      return problems.businessRule("agenda_item.not_draft", "Only a draft agenda item can be changed.");
    case "agenda_item_ordinal_key":
      return problems.duplicate("agenda_item.ordinal_taken", "Another agenda item of this meeting has this position.");
    case "meeting_minutes_published_immutable":
      return problems.businessRule("meeting_minutes.published", "Published minutes are immutable.");
    case "meeting_minutes_status_transition": {
      const [from, to] = meetingEdgeOf(error.message);
      return problems.businessRule(
        "meeting_minutes.status_transition",
        `These minutes cannot move from ${from} to ${to}.`,
      );
    }
    case "meeting_minutes_approved_frozen":
      return problems.businessRule(
        "meeting_minutes.approved_frozen",
        "Approved minutes are edited only after they are returned to draft.",
      );
    case "meeting_minutes_meeting_held":
      return problems.businessRule(
        "meeting_minutes.meeting_not_held",
        "Minutes are published after the meeting is held.",
      );
    case "meeting_minutes_required_output": {
      // The guard names the required kinds ("… at least one output of {benefit_evidence,forecast}"), not the forum.
      const kinds =
        /output of \{([^}]*)\}/
          .exec(error.message ?? "")?.[1]
          ?.split(",")
          .join(", ") ?? "its outputs";
      return problems.businessRule(
        "meeting_minutes.required_output_missing",
        `A forum meeting cannot be published without at least one of: ${kinds.replaceAll("_", " ")}.`,
      );
    }
    case "meeting_minutes_meeting_key":
      return problems.duplicate("meeting_minutes.exists", "This meeting already has minutes; update them instead.");
    case "meeting_attendance_person_key":
      return problems.duplicate(
        "meeting_attendance.exists",
        "Attendance for this person is already recorded; update it instead.",
      );
    case "meeting_attendance_proxy_present":
    case "meeting_attendance_not_self_proxy":
      return problems.validation([
        {
          pointer: "/onBehalfOfUserId",
          code: "validation.attendance_proxy",
          message: "A representative is recorded only for a present person, and never for themselves.",
        },
      ]);
    case "meeting_output_kind_of_forum": {
      const kind = /meeting_output: ([a-z_]+) is not an output/.exec(error.message ?? "")?.[1] ?? "This kind";
      return rule422("meeting_output.kind_not_in_forum", `${kind} is not an output of this forum.`, "/outputKind");
    }
    case "meeting_output_record_type":
      return rule422(
        "meeting_output.record_required",
        "This output links a record of type its kind requires.",
        "/recordType",
      );
    case "meeting_output_record_ref":
      return rule422(
        "meeting_output.record_not_found",
        "The linked record does not exist in this transformation.",
        "/recordId",
      );
    case "meeting_output_record_pair":
      return problems.validation([
        {
          pointer: "/recordId",
          code: "validation.record_pair",
          message: "A linked record names both its record type and its record.",
        },
      ]);
    case "meeting_output_note_or_record":
      return problems.validation([
        { pointer: "/note", code: "validation.required", message: "A required value is missing." },
      ]);
    case "agenda_item_starts_draft":
    case "agenda_item_identity_immutable":
    case "agenda_item_status_transition":
    case "agenda_item_ask_shape":
    case "agenda_item_published_complete":
    case "agenda_item_outcome_complete":
    case "meeting_attendance_identity":
    case "meeting_minutes_starts_draft":
    case "meeting_minutes_identity":
    case "meeting_minutes_approved_complete":
    case "meeting_minutes_published_complete":
    case "meeting_output_kind_valid":
    case "meeting_action_link_key":
      // The API never sends such a write: a programming error.
      return problems.internal();
    default:
      return null;
  }
}

// ---- P4 slice H block (ADR-0035 §11, ADR-0036 §10). BE-K's lines come first; BE-K2 and then BE-L append theirs
// (p4-work-split §H.2, §H.3).

const sliceHInvalidTransition = (code: string, detail: string): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.invalidTransition,
    code,
    title: "Invalid transition",
    detail,
  });

/**
 * P4 slice H, BE-K lines (T-DG4-BE-K; ADR-0035 §5, §6, §11): the database last lines behind the G5 scale scope and its
 * conditions, scale transitions and risk dispositions (0051). The API refuses each case first with the same code and
 * text; these mappings keep a race or a bypass from surfacing as a 500. Null when the error is not one of them.
 */
export function mapP4GateScaleError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "scale_transition_key":
      return problems.duplicate("scale.already_scaled", "This initiative is already scaled into this business unit.");
    case "scale_transition_g5_approved":
      return sliceHInvalidTransition(
        "gate.g5_not_approved",
        "Scaling requires the G5 (Scale) business approval, which is not approved for this transformation.",
      );
    case "scale_transition_in_approved_scope":
      return sliceHInvalidTransition(
        "scale.outside_approved_scope",
        "This initiative and business unit are outside the scale scope approved at G5.",
      );
    case "scale_transition_initiative_fkey":
      return rule422(
        "scale.outside_approved_scope",
        "This initiative and business unit are outside the scale scope approved at G5.",
        "/initiativeId",
      );
    case "gate_decision_scale_scope_g5_approved":
    case "gate_decision_condition_g5_approved":
      return rule422(
        "gate.scale_scope_not_applicable",
        "A scale scope is recorded only with a G5 approval.",
        "/scaleScope",
      );
    case "gate_decision_scale_scope_business_unit_org":
    case "gate_decision_scale_scope_initiative_fkey":
    case "gate_decision_scale_scope_key":
      return rule422(
        "gate.scale_scope_invalid",
        "Each scope item names an initiative of this transformation and a business unit of its organization.",
        "/scaleScope/items",
      );
    case "risk_disposition_open_risk":
    case "risk_disposition_raid_fkey":
      return rule422("risk_disposition.not_open_risk", "Only an open risk can be given a disposition.", "/raidEntryId");
    default:
      return null;
  }
}

/**
 * P4 slice H, BE-K2 lines (T-DG4-BE-K2; ADR-0035 §3, §4, §11): the 0051 guards behind per-criterion gate reviews and
 * gate exceptions. The API refuses each case first with the same code and text (workflows/gate-reviews.ts,
 * gate-exceptions.ts); these mappings keep a race or a bypass from surfacing as a 500. Null when the error is not
 * one of them. (Appended to the slice H block after BE-K, p4-work-split §H H.2.)
 */
export function mapP4GateReviewExceptionError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "gate_criterion_review_submission_pending":
      return problems.businessRule(
        "gate.review_not_open",
        "Only a submitted or under-review gate submission can be reviewed.",
      );
    case "gate_criterion_review_not_submitter":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "gate.reviewer_is_submitter",
        title: "Forbidden",
        detail: "The submitter cannot review their own gate submission.",
      });
    case "gate_criterion_review_condition_required":
      return rule422(
        "gate.review_condition_required",
        "An open condition is required when the criterion meets with conditions.",
        "/openCondition",
      );
    case "gate_criterion_review_no_key":
    case "gate_criterion_review_no_sequence":
      // Two reviews of one criterion raced for the same number: the caller re-reads and retries.
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "gate_exception_one_pending_key":
      return problems.duplicate(
        "gate_exception.already_pending",
        "An exception for this criterion is already awaiting a decision.",
      );
    case "gate_exception_mandatory_criterion":
      return rule422(
        "gate_exception.criterion_not_mandatory",
        "An exception can only cover a mandatory criterion of this gate.",
        "/criterionKey",
      );
    case "gate_exception_decider_not_requester":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "gate_exception.requester_cannot_decide",
        title: "Forbidden",
        detail: "The requester cannot decide their own exception.",
      });
    case "gate_exception_status_step":
    case "gate_exception_decision_final":
      return sliceHInvalidTransition(
        "gate_exception.not_pending",
        "Only a pending exception can be decided or withdrawn.",
      );
    default:
      return null;
  }
}

/**
 * P4 slice H, BE-L lines (ADR-0036 §1, §10; T-DG4-BE-L): the 0052 change-control constraints. The API checks each rule
 * first with the exact ADR texts; these are the last line when a concurrent write slips past a check. Null when the
 * error is not one of them. (Appended to the slice H block after BE-K/BE-K2, p4-work-split §H.3.)
 */
export function mapP4ChangeControlError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "change_request_kind_subject":
      return new HttpProblem({
        status: 422,
        type: PROBLEM_TYPES.validation,
        code: "change_request.kind_subject_mismatch",
        title: "Business rule violated",
        detail: "This kind of change does not apply to that record.",
        errors: [
          {
            pointer: "/subjectType",
            code: "change_request.kind_subject_mismatch",
            message: "This kind of change does not apply to that record.",
          },
        ],
      });
    case "change_request_content_frozen":
      return new HttpProblem({
        status: 422,
        type: PROBLEM_TYPES.invalidTransition,
        code: "change_request.not_editable",
        title: "Invalid transition",
        detail: "Only a draft change request, or one returned for changes, can be edited.",
      });
    case "change_request_final":
      return new HttpProblem({
        status: 422,
        type: PROBLEM_TYPES.invalidTransition,
        code: "change_request.not_withdrawable",
        title: "Invalid transition",
        detail: "A decided change request cannot be withdrawn.",
      });
    case "change_request_one_open_per_subject":
    case "change_request_code_key":
    case "change_control_policy_transformation_key":
    case "impact_assessment_version_key":
    case "impact_assessment_item_ordinal_key":
      // Serialised by the change-request subject lock in the API; a concurrent write that slips past it retries.
      return retryConflict();
    case "change_request_status_step":
    case "change_request_identity":
    case "change_request_outcome_needs_decision":
    case "change_request_assessment_current":
    case "change_request_proposed_pair":
    case "change_request_proposed_kind":
    case "change_request_submitted_complete":
    case "change_request_decided_complete":
    case "change_request_applied_complete":
    case "change_request_withdrawn_complete":
      // The API never sends such a write (no job or trigger decides a change request): a programming error.
      return problems.internal();
    default:
      return null;
  }
}

// ------------------------------------------------------------------------------------------------ P4 slices J/K
// BE-M block (T-DG4-BE-M; ADR-0038 §12): the 0055 trace-link and contribution-share constraints. The API answers each
// rule first (reporting/traceability.ts, portfolio/links.ts); these mappings are the backstop for a write that slips
// past it (e.g. the trigger's 100 % rule under a concurrent write).

/** The exact ADR-0038 §12 refusal of a set above 100 %, with the total the trigger reports ("would total 1.100000"). */
function allocationExceedsProblem(error: PgErrorLike): HttpProblem {
  const total = /would total ([0-9]+(?:\.[0-9]+)?)/.exec(error.message ?? "")?.[1];
  const detail =
    total !== undefined ? allocationExceedsText(total) : "The allocations into this record would total more than 100%.";
  return new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code: "trace_link.allocation_exceeds_total",
    title: "Business rule violated",
    detail,
    errors: [{ pointer: "/allocationShare", code: "trace_link.allocation_exceeds_total", message: detail }],
  });
}

const traceRule = (code: string, detail: string, pointer: string): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

/** Maps the 0055 trace-link and contribution-share constraints (BE-M), or null when the error is not one of them. */
export function mapP4TraceabilityError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "trace_allocation_total":
      return allocationExceedsProblem(error);
    case "trace_link_one_active_key":
      return problems.duplicate("trace_link.duplicate", "These two records are already linked.");
    case "trace_link_kind_shape":
      return traceRule(
        "trace_link.pair_not_allowed",
        "This kind of link cannot connect these two records.",
        "/linkKind",
      );
    case "trace_link_allocation_kind":
      return traceRule(
        "trace_link.share_not_allowed",
        "A share can be set only on a link into a KPI or a benefit.",
        "/allocationShare",
      );
    case "initiative_outcome_contribution_allocation_needs_kpi":
      return traceRule(
        "contribution.allocation_needs_kpi",
        "A share needs the contribution's KPI; name the KPI first.",
        "/allocationShare",
      );
    case "trace_link_finding_fkey":
    case "trace_link_tom_gap_fkey":
    case "trace_link_deliverable_fkey":
    case "trace_link_capability_fkey":
    case "trace_link_outcome_kpi_fkey":
    case "trace_link_benefit_fkey":
      return traceRule(
        "trace_link.record_not_found",
        "The linked record does not exist in this transformation.",
        "/fromId",
      );
    case "trace_link_basis_needs_share":
    case "initiative_outcome_contribution_basis_needs_share":
    case "trace_link_removal_complete":
      // The API validates these before writing: reaching the constraint is a programming error.
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P4 slice K, BE-M2 lines (T-DG4-BE-M2; ADR-0038 §12): the 0055 `inherited_record` guards. The API refuses each case
 * first with the same code and text (reporting/modular.ts); these are the last line when a concurrent write slips past
 * a check, so it never surfaces as a 500. Null when the error is not one of them. (Slices J/K block, after BE-M.)
 */
export function mapP4ModularEntryError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "inherited_record_modular_only":
      return problems.businessRule(
        "inherited_record.not_modular",
        "Inherited records can be recorded only for a transformation in Modular entry.",
      );
    case "inherited_record_one_active_key":
      return problems.duplicate("inherited_record.duplicate", "This record is already recorded as inherited.");
    case "inherited_record_evidence_fkey":
    case "inherited_record_baseline_fkey":
      return traceRule(
        "inherited_record.record_not_found",
        "The evidence item or baseline does not exist in this transformation or is archived.",
        error.constraint === "inherited_record_evidence_fkey" ? "/evidenceId" : "/baselineId",
      );
    case "inherited_record_immutable":
      return new HttpProblem({
        status: 422,
        type: PROBLEM_TYPES.invalidTransition,
        code: "inherited_record.not_active",
        title: "Invalid transition",
        detail: "This inherited record has already been withdrawn.",
      });
    case "inherited_record_starts_active":
    case "inherited_record_kind_shape":
    case "inherited_record_withdrawal_complete":
      // The API writes these shapes itself: reaching the constraint is a programming error.
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P4 slice K, BE-M3 lines (T-DG4-BE-M3; ADR-0038 §12): the 0055 portfolio and workstream guards. The API refuses each
 * case first with the same code and text (portfolio/structure.ts); these are the last line when a concurrent write
 * slips past a check, so it never surfaces as a 500. Null when the error is not one of them. (Slices J/K block, after
 * BE-M2.)
 */
export function mapP4StructureError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "portfolio_org_code_key":
      return problems.duplicate("portfolio.code_taken", "Another portfolio of this organization uses this code.");
    case "portfolio_transformation_one_active_key":
      return problems.businessRule(
        "portfolio.transformation_already_placed",
        "This transformation already sits in a portfolio.",
      );
    case "workstream_initiative_one_active_key":
      return problems.businessRule(
        "workstream.initiative_already_assigned",
        "This initiative already belongs to a workstream.",
      );
    case "workstream_code_key":
    case "portfolio_archive_complete":
    case "portfolio_transformation_removal_complete":
    case "workstream_archive_complete":
    case "workstream_initiative_removal_complete":
      // The API assigns codes from the counter and writes these shapes itself: reaching one is a programming error.
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P4 slice J, KBE-G lines (ADR-0037 §13; T-DG4-KBE-G): the 0056 dashboard RAG policy constraints. The API checks the
 * order first with the exact ADR text (dashboards/rag-policy.ts); these are the last line. Null when the error is not
 * one of them. (Slices J/K block: appended after BE-M's lines at merge, p4-work-split §J+K JK.4.)
 */
export function mapP4DashboardError(error: PgErrorLike): HttpProblem | null {
  const detail = "The amber threshold cannot be beyond the red threshold.";
  const pointer =
    error.constraint === "dashboard_rag_policy_value_gap_order"
      ? "/valueGapAmberRatio"
      : error.constraint === "dashboard_rag_policy_milestone_slip_order"
        ? "/milestoneSlipAmberWorkingDays"
        : null;
  if (pointer !== null)
    return new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "dashboard_rag_policy.threshold_order",
      title: "Business rule violated",
      detail,
      errors: [{ pointer, code: "dashboard_rag_policy.threshold_order", message: detail }],
    });
  if (error.constraint === "dashboard_rag_policy_organization_key") return retryConflict();
  return null;
}

/**
 * P4 slice H, BE-L2 lines (T-DG4-BE-L2; ADR-0035 §1, §11): the 0051 phase-step and step-evidence guards. The API refuses
 * each case first with the same code and text; these are the last line when a concurrent write slips past a check (a
 * race), so it never surfaces as a 500. Null when the error is not one of them. (Appended after BE-L, p4-work-split §H.4.)
 */
export function mapP4PhaseStepError(error: PgErrorLike): HttpProblem | null {
  const stepTransition = (from: string, to: string) =>
    sliceHInvalidTransition(
      "phase_step.invalid_transition",
      `A step moves from ${from} to ${to} only as the phase procedure allows.`,
    );
  switch (error.constraint ?? "") {
    case "phase_step_key":
      // Two first writes of the same step (If-Match "0") raced: the loser's version is stale.
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "phase_step_status_step": {
      const m = /: (\w+) -> (\w+) is not an allowed transition/.exec(error.message ?? "");
      return m ? stepTransition(m[1]!, m[2]!) : stepTransition("its status", "the requested status");
    }
    case "phase_step_complete_final":
      return stepTransition("complete", "another status");
    case "phase_step_owner_locked_in_review":
      return stepTransition("in_review", "in_review");
    case "phase_step_reviewer_separate":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "phase_step.reviewer_is_owner",
        title: "Forbidden",
        detail: "The owner cannot review their own step.",
      });
    case "phase_step_returned_note":
      return new HttpProblem({
        status: 400,
        type: PROBLEM_TYPES.validation,
        code: "phase_step.return_note_required",
        title: "Validation failed",
        detail: "A note is required to return a step.",
        errors: [
          {
            pointer: "/note",
            code: "phase_step.return_note_required",
            message: "A note is required to return a step.",
          },
        ],
      });
    case "phase_step_evidence_active_key":
      return problems.duplicate("phase_step_evidence.exists", "This evidence is already linked to the step.");
    case "phase_step_evidence_step_open":
      return rule422("phase_step.complete", "This step is complete; its evidence can no longer change.", "");
    case "phase_step_evidence_evidence_fkey":
      return rule422(
        "validation.reference",
        "The referenced record does not exist in this transformation.",
        "/evidenceId",
      );
    case "phase_step_evidence_status_step":
      return problems.invalidTransition("The evidence link is already removed.");
    case "phase_step_in_review_checked":
    case "phase_step_complete_shape":
    case "phase_step_identity":
    case "phase_step_review_requested_complete":
    case "phase_step_reviewed_complete":
    case "phase_step_definition_fkey":
    case "phase_step_evidence_removed_complete":
      // The API evaluates the rule, sets the stamps and never sends such a write: a programming error.
      return problems.internal();
    default:
      return null;
  }
}

/**
 * Maps a P2 database guard or template-constraint error to a problem, or null when the error is not one of them (the
 * generic mapping in hooks.ts then applies).
 */
/**
 * P5 slice A (T-DG5-BE-A; p5-work-split §A.10 item 2): the 0062-0064 guards. The API refuses first with the
 * ADR-0039 §13 / ADR-0040 §8 codes and exact texts; a guard reached only under a race (two writers of the same draft,
 * migration or pin) maps to the same refusal, and a guard that only a programming error can reach maps to 500.
 *   methodology_version_one_open_draft_key                  -> 409 config_version.draft_exists (duplicate)
 *   methodology_version_content_frozen, methodology_element_draft_only, methodology_version_stage_transition,
 *   methodology_version_status_transition                   -> 409 config_version.not_editable
 *   methodology_version_identity_fixed, methodology_element_identity_fixed -> 422 config_version.stable_id_change
 *   methodology_element_fixed_sets                          -> 422 config_version.source_element_protected
 *   methodology_element_source_identity, methodology_element_kind_type -> 422 config_version.unknown_element
 *   methodology_element_no_admin_approver                   -> 422 config_version.admin_approver_forbidden
 *   methodology_version_preview_required                    -> 422 config_version.preview_required
 *   methodology_version_review_required                     -> 422 config_version.review_required
 *   methodology_version_checks_required                     -> 422 config_version.checks_required
 *   methodology_version_weights_total                       -> 422 config_version.weights_total
 *   methodology_element_weight_decimal                      -> 400 validation.weight_percent (field /weightPercent)
 *   methodology_version_rollback_complete                   -> 422 config_version.rollback_target_invalid
 *   config_review_request_reviewer_not_requester, config_review_request_reviewer_not_author,
 *   config_review_request_reviewer_not_contributor (0097; D-170)  -> 403 config_review.self_review
 *   config_review_policy_reviewer_not_auditor, config_review_policy_reviewer_not_admin -> 422 config_review.reviewer_not_allowed
 *   methodology_migration_one_open_key                      -> 409 methodology_migration.open_exists (duplicate)
 *   methodology_migration_target_published, methodology_migration_versions_differ -> 422 methodology_migration.target_invalid
 *   methodology_migration_decider_not_requester             -> 403 methodology_migration.self_approval
 *   methodology_migration_from_is_pin, transformation_config_pin_moves_by_migration -> 409 methodology_migration.pin_moved
 *   methodology_migration_status_transition                 -> 422 methodology_migration.not_open
 *   methodology_version_next_number, methodology_version_seed_only, methodology_version_created_as_draft,
 *   methodology_version_publish_ready, methodology_version_draft_lineage, methodology_version_kind_key,
 *   transformation_config_pin_kind_matches, transformation_config_pin_published, transformation_config_pin_kind_fixed,
 *   transformation_config_pin_history_required, revision_proposal_dedupe_shape -> 500 (a programming error)
 */
export function mapP5StudioError(error: PgErrorLike): HttpProblem | null {
  const rule = (code: string, detail: string) => problems.businessRule(code, detail);
  switch (error.constraint ?? "") {
    case "methodology_version_one_open_draft_key":
      return problems.duplicate(
        "config_version.draft_exists",
        "A draft of this configuration already exists. Continue it or discard it first.",
      );
    case "methodology_version_content_frozen":
    case "methodology_element_draft_only":
    case "methodology_version_stage_transition":
    case "methodology_version_status_transition":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.invalidTransition,
        code: "config_version.not_editable",
        title: "Not editable",
        detail: "This configuration version is published or no longer being edited. Create a new draft to change it.",
      });
    case "methodology_version_identity_fixed":
    case "methodology_element_identity_fixed":
      return rule("config_version.stable_id_change", "Stable identifiers cannot be changed. Change the label instead.");
    case "methodology_element_fixed_sets":
      return rule(
        "config_version.source_element_protected",
        "Source phases, gates and TOM dimensions cannot be added or deleted.",
      );
    case "methodology_element_source_identity":
    case "methodology_element_kind_type":
      return rule("config_version.unknown_element", "This element does not exist in the methodology.");
    case "methodology_element_no_admin_approver":
      return rule(
        "config_version.admin_approver_forbidden",
        "An administrator role or the auditor cannot be configured as an approver.",
      );
    case "methodology_version_preview_required":
      return rule("config_version.preview_required", "Run a successful preview and test of the current draft first.");
    case "methodology_version_review_required":
      return rule("config_version.review_required", "This change needs an approved review before it can be published.");
    case "methodology_version_checks_required":
      return rule(
        "config_version.checks_required",
        "Run the compatibility and source-coverage checks for the current draft first.",
      );
    case "methodology_version_weights_total":
      return rule("config_version.weights_total", "Default weights must total exactly 100% over 2 to 6 criteria.");
    case "methodology_element_weight_decimal": {
      const message = "Enter a weight as a percentage with at most two decimals, greater than 0 and at most 100.";
      return new HttpProblem({
        status: 400,
        type: PROBLEM_TYPES.validation,
        code: "validation",
        title: "Validation failed",
        detail: message,
        errors: [{ pointer: "/weightPercent", code: "validation.weight_percent", message }],
      });
    }
    case "methodology_version_rollback_complete":
      return rule(
        "config_version.rollback_target_invalid",
        "Only an earlier published version of the same configuration can be restored.",
      );
    case "config_review_request_reviewer_not_requester":
    case "config_review_request_reviewer_not_author":
    case "config_review_request_reviewer_not_contributor":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "config_review.self_review",
        title: "Forbidden",
        detail: "You cannot review a configuration change you authored or requested.",
      });
    case "config_review_policy_reviewer_not_auditor":
    case "config_review_policy_reviewer_not_admin":
      return rule(
        "config_review.reviewer_not_allowed",
        "The auditor or an administrator role cannot be the configured reviewer.",
      );
    case "methodology_migration_one_open_key":
      return problems.duplicate(
        "methodology_migration.open_exists",
        "This transformation already has an open migration for this configuration.",
      );
    case "methodology_migration_target_published":
    case "methodology_migration_versions_differ":
      return rule(
        "methodology_migration.target_invalid",
        "The target must be a published version of the same configuration, other than the pinned one.",
      );
    case "methodology_migration_decider_not_requester":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "methodology_migration.self_approval",
        title: "Forbidden",
        detail: "You cannot approve a migration you requested.",
      });
    case "methodology_migration_from_is_pin":
    case "transformation_config_pin_moves_by_migration":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "methodology_migration.pin_moved",
        title: "Version conflict",
        detail: "The transformation's pinned version changed after this migration was planned. Plan it again.",
      });
    case "methodology_migration_status_transition":
      return rule("methodology_migration.not_open", "This migration is no longer open.");
    case "methodology_version_next_number":
    case "methodology_version_seed_only":
    case "methodology_version_created_as_draft":
    case "methodology_version_publish_ready":
    case "methodology_version_draft_lineage":
    case "methodology_version_kind_key":
    case "transformation_config_pin_kind_matches":
    case "transformation_config_pin_published":
    case "transformation_config_pin_kind_fixed":
    case "transformation_config_pin_history_required":
    case "revision_proposal_dedupe_shape":
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P5 slice D (T-DG5-BE-H; ADR-0043 §9): the 0074 rule and version guards that a request can reach in a race (two
 * concurrent requests both passing the API's own check first). Every other 0074 guard is refused by the API first with
 * its §9 code, so reaching it is a programming error (500).
 *   automation_rule_code_key                -> 409 automation_rule.code_taken
 *   automation_rule_version_one_open_key    -> 409 automation_rule_version.draft_exists
 *   automation_rule_version_content_frozen  -> 409 automation_rule_version.not_editable
 *   automation_rule_version_reviewer_not_contributor (0097; D-170) -> 403 automation_rule_version.self_review
 */
export function mapP5AutomationError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "automation_rule_code_key":
      return problems.duplicate("automation_rule.code_taken", "A rule with this code already exists.");
    case "automation_rule_version_one_open_key":
      return problems.duplicate("automation_rule_version.draft_exists", "This rule already has an open version.");
    case "automation_rule_version_content_frozen":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.invalidTransition,
        code: "automation_rule_version.not_editable",
        title: "Not editable",
        detail: "Only a draft version can be changed; published versions never change.",
      });
    case "automation_rule_version_reviewer_not_contributor":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "automation_rule_version.self_review",
        title: "Forbidden",
        detail: "You cannot review a version you authored.",
      });
    default:
      return null;
  }
}

/**
 * P5 slice F (T-DG5-KBE-C; ADR-0045 §11): the 0080 report-snapshot guards that a request can reach in a race (the API
 * refuses first under lock class reportSnapshotIssue; a concurrent writer can still pass that check first). Every other 0080 guard is
 * refused by the API first, so reaching it is a programming error (500).
 *   report_snapshot_one_issued_key, report_snapshot_series_issue_key, report_snapshot_issue_next,
 *   report_snapshot_superseded_by_issued                     -> 409 report_snapshot.series_changed
 *   report_snapshot_reissue_of_issued                        -> 422 report_snapshot.not_issued
 *   report_snapshot_transition                               -> 422 report_snapshot.not_generated
 *   report_snapshot_subject_ref                              -> 422 report.subject_invalid
 */
export function mapP5ReportError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "report_snapshot_one_issued_key":
    case "report_snapshot_series_issue_key":
    case "report_snapshot_issue_next":
    case "report_snapshot_superseded_by_issued":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "report_snapshot.series_changed",
        title: "Version conflict",
        detail: "This report was issued or reissued meanwhile; reload it.",
      });
    case "report_snapshot_reissue_of_issued":
      return problems.businessRule("report_snapshot.not_issued", "Only the current issued snapshot can be reissued.");
    case "report_snapshot_transition":
      return problems.businessRule(
        "report_snapshot.not_generated",
        "Only a generated snapshot can be issued or discarded.",
      );
    case "report_snapshot_subject_ref":
      return problems.businessRule(
        "report.subject_invalid",
        "The subject must be a record of this transformation of the type this output reports on.",
      );
    default:
      return null;
  }
}

/**
 * P5 slice F (T-DG5-KBE-D; ADR-0045 §6, §11): the 0080 owner-update guards a request can reach in a race (the API
 * refuses first: it checks the subject, the period and the state under the row lock and a shared lock on the period,
 * but a concurrent create can still pass the existence check first). Every other owner_update guard is refused by the
 * API first, so reaching it is a programming error (500).
 *   owner_update_subject_period_key                          -> 409 owner_update.exists
 *   owner_update_period_open                                 -> 422 owner_update.period_not_open
 *   owner_update_submitted_frozen                            -> 422 owner_update.not_draft
 *   owner_update_submitted_has_content                       -> 422 owner_update.empty
 */
export function mapP5OwnerUpdateError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "owner_update_subject_period_key":
      return problems.duplicate(
        "owner_update.exists",
        "An update for this subject and reporting period already exists.",
      );
    case "owner_update_period_open":
      return problems.businessRule(
        "owner_update.period_not_open",
        "Updates can be written only while their reporting period is open.",
      );
    case "owner_update_submitted_frozen":
      return problems.businessRule("owner_update.not_draft", "Only a draft update can be changed or submitted.");
    case "owner_update_submitted_has_content":
      return problems.businessRule("owner_update.empty", "Write at least one of the eight fields before submitting.");
    default:
      return null;
  }
}

/**
 * P5 slice F (T-DG5-BE-M; ADR-0046 §5, §8): the 0081 export-job guards a request can reach. The API checks the format
 * and the snapshot first (reporting/exports/jobs.ts), so these answer only a race (a snapshot discarded between the
 * check and the insert; a job that finished while a cancel waited). The request key is resolved by ON CONFLICT in the
 * API, and every other export_job guard is the worker's own state machine (reaching it from a request is a 500).
 *   export_job_format_offered                                -> 422 export.format_not_offered
 *   export_job_snapshot_exportable                           -> 422 export.snapshot_discarded
 *   export_job_transition, export_job_finished_frozen        -> 422 export.not_cancellable
 */
export function mapP5ExportError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "export_job_format_offered":
      return problems.businessRule("export.format_not_offered", "This output cannot be exported in that format.");
    case "export_job_snapshot_exportable":
      return problems.businessRule("export.snapshot_discarded", "A discarded snapshot cannot be exported.");
    case "export_job_transition":
    case "export_job_finished_frozen":
      return problems.businessRule("export.not_cancellable", "Only a queued or running export can be cancelled.");
    default:
      return null;
  }
}

/**
 * P5 slice I (T-DG5-BE-Q; ADR-0049 §1, §4): the 0089 guards of the playbook catalogue seeded by 0092. mth_app holds
 * SELECT only on playbook_block and playbook_block_link, and the reader never writes, so reaching one of these is a
 * programming error (500), never a user-facing refusal:
 *   playbook_block_immutable, playbook_block_ordinal_matches, playbook_block_section_before,
 *   playbook_block_ordinal_key, playbook_block_link_target_shape, playbook_block_link_ordinal_key -> 500
 */
export function mapP5PlaybookBlockError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "playbook_block_immutable":
    case "playbook_block_ordinal_matches":
    case "playbook_block_section_before":
    case "playbook_block_ordinal_key":
    case "playbook_block_link_target_shape":
    case "playbook_block_link_ordinal_key":
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P5 slice I (T-DG5-BE-Q2; ADR-0049 §6, §11): the 0089 trigger methodology_element_reader_guard on the Studio reader
 * namespaces of `methodology_text` (profile.*, block.*, provenance.note). The API checks first with the same codes
 * (methodology/element-profiles.ts); these are the database's last line:
 *   methodology_element_reader_namespace, methodology_element_reader_profile -> 422 methodology_reader.invalid_override
 *   methodology_element_reader_block                                         -> 422 methodology_reader.invalid_block_link
 *   methodology_element_reader_text                                          -> 422 methodology_reader.prohibited_text
 */
export function mapP5MethodologyReaderError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "methodology_element_reader_namespace":
    case "methodology_element_reader_profile":
      return problems.businessRule(
        "methodology_reader.invalid_override",
        "A provenance or question-tag override must name a seeded element, use an allowed value, and tag only a template.",
      );
    case "methodology_element_reader_block":
      return problems.businessRule(
        "methodology_reader.invalid_block_link",
        "A block link must name an existing block and a template, procedure or requirement in the allowed format.",
      );
    case "methodology_element_reader_text":
      return problems.businessRule(
        "methodology_reader.prohibited_text",
        "Reader text must not claim official PMI status or certification, or name an engineering delivery gate.",
      );
    default:
      return null;
  }
}

/**
 * P5 slice E (T-DG5-BE-L2's proposal, added by D-155 (c) to T-DG5-BE-C2; ADR-0044 §6, §10): the 0075 cut-off pack guards.
 * The API refuses first with the same codes and English texts (governance/cut-off.ts `cutoffRefusals`, under the pack's
 * row lock); these answer only a race the API check cannot see (a concurrent review, a chair or secretary changed in
 * between, an item published while its pack was still a draft):
 *   agenda_item_cutoff_pack_unreviewed -> 422 agenda_item.pack_not_reviewed
 *   meeting_cutoff_pack_reviewer       -> 403 meeting_cutoff_pack.not_reviewer
 *   meeting_cutoff_pack_transition     -> 422 meeting_cutoff_pack.already_reviewed
 */
export function mapP5CutoffPackError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "agenda_item_cutoff_pack_unreviewed":
      return problems.businessRule(
        "agenda_item.pack_not_reviewed",
        "Review the meeting's cut-off pack before publishing its items.",
      );
    case "meeting_cutoff_pack_reviewer":
      return forbidden403(
        "meeting_cutoff_pack.not_reviewer",
        "Only the meeting's chair or secretary can review its pack.",
      );
    case "meeting_cutoff_pack_transition":
      return problems.businessRule("meeting_cutoff_pack.already_reviewed", "This pack is already reviewed.");
    default:
      return null;
  }
}

/**
 * P5 slice H (T-DG5-BE-P; ADR-0048 §9): the 0086 launch_plan/launch_task guards a request can reach. The API refuses
 * first under the launchPlan lock with the same codes (launch/plan.ts, tasks.ts, predecessors.ts); these are
 * the database's last line. The template-identity guards are never reachable from a request (500).
 *   launch_plan_transformation_key, launch_plan_idempotency_key -> 409 launch_plan.exists
 *   launch_task_status_step                                      -> 422 launch_task.status_step
 *   launch_task_completed_dates_fixed                            -> 422 launch_task.completed_dates_fixed
 *   launch_task_output_record, launch_task_output_link           -> 422 launch_task.output_record_invalid
 *   launch_task_predecessor_no_cycle, launch_task_predecessor_not_self -> 422 launch_task.predecessor_cycle
 *   launch_task_predecessor_same_plan                            -> 422 launch_task.predecessor_other_plan
 *   launch_plan_identity_fixed, launch_plan_shift_recorded, launch_task_identity_fixed, launch_task_template_match,
 *   launch_task_created_not_started, launch_task_predecessor_immutable -> 500
 */
export function mapP5LaunchPlanError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "launch_plan_transformation_key":
    case "launch_plan_idempotency_key":
      return problems.duplicate("launch_plan.exists", "This transformation already has a 90-day launch plan.");
    case "launch_task_status_step":
      return problems.businessRule("launch_task.status_step", "This status change is not allowed for the task.");
    case "launch_task_completed_dates_fixed":
      return problems.businessRule(
        "launch_task.completed_dates_fixed",
        "A completed task keeps its dates; reopen it first.",
      );
    case "launch_task_output_record":
    case "launch_task_output_link":
      return problems.businessRule(
        "launch_task.output_record_invalid",
        "The output must be a record of the required type in this transformation.",
      );
    case "launch_task_predecessor_no_cycle":
    case "launch_task_predecessor_not_self":
      return problems.businessRule(
        "launch_task.predecessor_cycle",
        "This predecessor would make the tasks depend on each other in a loop.",
      );
    case "launch_task_predecessor_same_plan":
      return problems.businessRule(
        "launch_task.predecessor_other_plan",
        "A predecessor must be a task of the same launch plan.",
      );
    case "launch_plan_identity_fixed":
    case "launch_plan_shift_recorded":
    case "launch_task_identity_fixed":
    case "launch_task_template_match":
    case "launch_task_created_not_started":
    case "launch_task_predecessor_immutable":
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P5 slice H (T-DG5-BE-P2; ADR-0048 §4, §9): the 0086 day_ninety_test/day_ninety_response guards a request can reach.
 * The API refuses first under the test's row lock with the same codes (launch/day-ninety.ts); these are the database's
 * last line (a concurrent writer that passed the API's check first).
 *   day_ninety_test_completed_complete                         -> 422 day_ninety_test.incomplete
 *   day_ninety_test_completed_final, day_ninety_response_test_open -> 422 day_ninety_test.completed
 *   day_ninety_response_evidence_fkey                          -> 422 validation.reference (/evidenceId)
 *   day_ninety_response_key, day_ninety_test_created_open, day_ninety_response_identity_fixed,
 *   day_ninety_test_answered_count                             -> 500 (unreachable: every response write holds the
 *                                                                 test's row lock and steps its version)
 */
export function mapP5DayNinetyError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "day_ninety_test_completed_complete":
      return problems.businessRule(
        "day_ninety_test.incomplete",
        "Answer all six questions before completing the Day-90 leadership test.",
      );
    case "day_ninety_test_completed_final":
    case "day_ninety_response_test_open":
      return problems.businessRule(
        "day_ninety_test.completed",
        "The Day-90 leadership test is complete; its responses can no longer change.",
      );
    case "day_ninety_response_evidence_fkey":
      return new HttpProblem({
        status: 422,
        type: "urn:mth:problem:validation",
        code: "validation.reference",
        title: "Business rule violated",
        detail: "No such evidence in this transformation.",
        errors: [
          {
            pointer: "/evidenceId",
            code: "validation.validation.reference",
            message: "No such evidence in this transformation.",
          },
        ],
      });
    case "day_ninety_response_key":
    case "day_ninety_test_created_open":
    case "day_ninety_response_identity_fixed":
    case "day_ninety_test_answered_count":
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P5 slice G (T-DG5-KBE-E; ADR-0047 §2, §8): the 0085 kpi_restatement guards a request can reach in a race. The API
 * refuses first, under the kpiRestatement advisory lock and the row lock, with the same codes (kpi/restatements.ts); these answer a
 * concurrent writer that passed the API's check first, and the deferred COMMIT checks. Every other kpi_restatement guard
 * (identity, counts, applied run, reissue offers) is refused by the API or written only by the worker, so reaching one
 * from a request is a programming error (500).
 *   kpi_restatement_one_open_key                             -> 409 kpi_restatement.open_exists
 *   kpi_restatement_version_approved                         -> 422 kpi_restatement.version_not_approved
 *   kpi_restatement_period_closed                            -> 422 kpi_restatement.period_not_closed
 *   kpi_restatement_period_draft_only, kpi_restatement_status_step,
 *   kpi_restatement_reconciliation_at_submit                 -> 422 kpi_restatement.not_draft
 *   kpi_restatement_reconciled                               -> 422 kpi_restatement.nothing_to_reconcile
 *   kpi_restatement_sod                                      -> 403 kpi_restatement.self_decision
 *   kpi_restatement_reject_note                              -> 422 kpi_restatement.note_required
 *   kpi_restatement_decision_frozen                          -> 422 kpi_restatement.not_submitted
 */
export function mapP5KpiRestatementError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "kpi_restatement_one_open_key":
      return problems.duplicate("kpi_restatement.open_exists", "This KPI already has a restatement in progress.");
    case "kpi_restatement_version_approved":
      return problems.businessRule(
        "kpi_restatement.version_not_approved",
        "A restatement applies an approved KPI version (active or superseded) of this KPI.",
      );
    case "kpi_restatement_period_closed":
      return problems.businessRule(
        "kpi_restatement.period_not_closed",
        "Only closed reporting periods of the KPI's frequency can be restated; an open period takes the new version from now on.",
      );
    case "kpi_restatement_period_draft_only":
    case "kpi_restatement_status_step":
    case "kpi_restatement_reconciliation_at_submit":
      return problems.businessRule(
        "kpi_restatement.not_draft",
        "Only a draft restatement can be changed or submitted.",
      );
    case "kpi_restatement_reconciled":
      return problems.businessRule(
        "kpi_restatement.nothing_to_reconcile",
        "None of the selected periods has a value to restate.",
      );
    case "kpi_restatement_sod":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "kpi_restatement.self_decision",
        title: "Forbidden",
        detail: "The requester of a restatement cannot decide it.",
      });
    case "kpi_restatement_reject_note":
      return problems.businessRule("kpi_restatement.note_required", "A rejection needs a note.");
    case "kpi_restatement_decision_frozen":
      return problems.businessRule("kpi_restatement.not_submitted", "Only a submitted restatement can be decided.");
    default:
      return null;
  }
}

/**
 * P5 slice G (T-DG5-KBE-F; ADR-0047 §5, §8): the 0085 financial_metric_setting / financial_cash_flow(_set) guards a
 * request can reach. The API refuses first (benefits/financial-metrics.ts: the If-Match check under the row lock, the
 * discount-rate range, the period rules, the case currency), so these answer a race (two concurrent `"0"` creates)
 * or are the database's last line with the same codes and texts:
 *   financial_metric_setting_org_key, financial_cash_flow_set_case_key   -> 409 version_conflict
 *   financial_metric_setting_assumptions_complete                        -> 422 financial_metrics.assumptions_incomplete
 *   financial_metric_setting_discount_rate_check                         -> 422 financial_metrics.discount_rate_invalid
 *   financial_cash_flow_set_currency                                     -> 422 financial_cash_flows.currency_mismatch
 *   financial_cash_flow_set_rows, financial_cash_flow_period_key,
 *   financial_cash_flow_set_line_count_check, financial_cash_flow_period_index_check
 *                                                                        -> 422 financial_cash_flows.periods_invalid
 */
export function mapP5FinancialMetricError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "financial_metric_setting_org_key":
    case "financial_cash_flow_set_case_key":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "financial_metric_setting_assumptions_complete":
      return problems.businessRule(
        "financial_metrics.assumptions_incomplete",
        "Set the methodology statement, timing and period basis together.",
      );
    case "financial_metric_setting_discount_rate_check":
      return problems.businessRule(
        "financial_metrics.discount_rate_invalid",
        "The discount rate is a decimal fraction from 0 to 1 per period (0.10 = 10%).",
      );
    case "financial_cash_flow_set_currency":
      return problems.businessRule(
        "financial_cash_flows.currency_mismatch",
        "Cash flows are entered in the business case currency.",
      );
    case "financial_cash_flow_set_rows":
    case "financial_cash_flow_period_key":
    case "financial_cash_flow_set_line_count_check":
    case "financial_cash_flow_period_index_check":
      return problems.businessRule(
        "financial_cash_flows.periods_invalid",
        "Cash flows need one row per period index from 0, with no gap and at most 121 rows.",
      );
    default:
      return null;
  }
}

/**
 * P5 slice H (T-DG5-KBE-G; ADR-0048 §6, §9): the 0086 health-check scheme guards a Studio request can reach. The kind
 * provider (health/provider.ts) refuses first with the same codes (element edits, preview, compatibility); these
 * answer the publish guard `health_scheme_publish_guard` (it raises the `p5_health_scheme_problem` result as its
 * constraint name) and the element guard's two health rules, reached only in a race or by a programming error.
 *   health_scheme_definition                         -> 422 health_scheme.definition_invalid (proposed; no §9 row)
 *   health_scheme_yes_no_required                    -> 422 health_scheme.yes_no_required
 *   health_scheme_credit, methodology_element_health_credit -> 422 health_scheme.credit_invalid
 *   health_scheme_na_needs_percent                   -> 422 health_scheme.na_needs_percent
 *   health_scheme_bands_invalid, methodology_element_health_band -> 422 health_scheme.bands_invalid
 *   health_scheme_own_bands_required                 -> 422 health_scheme.own_bands_required
 */
export function mapP5HealthSchemeError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "health_scheme_definition":
      return problems.businessRule(
        "health_scheme.definition_invalid",
        "A scheme's definition needs a score basis (points or percent of the applicable questions) and 25 questions.",
      );
    case "health_scheme_yes_no_required":
      return problems.businessRule("health_scheme.yes_no_required", "A scheme keeps Yes = 1 and No = 0.");
    case "health_scheme_credit":
    case "methodology_element_health_credit":
      return problems.businessRule(
        "health_scheme.credit_invalid",
        "Partial credit is a decimal between 0 and 1; N/A has no credit.",
      );
    case "health_scheme_na_needs_percent":
      return problems.businessRule(
        "health_scheme.na_needs_percent",
        "A scheme with N/A scores as a percentage of the applicable questions.",
      );
    case "health_scheme_bands_invalid":
    case "methodology_element_health_band":
      return problems.businessRule(
        "health_scheme.bands_invalid",
        "Bands need one band starting at 0 and distinct starting scores within the maximum score.",
      );
    case "health_scheme_own_bands_required":
      return problems.businessRule(
        "health_scheme.own_bands_required",
        "A scheme with partial credit or N/A needs its own interpretation bands; the four source bands cannot be reused.",
      );
    default:
      return null;
  }
}

/**
 * P5 slice H (T-DG5-KBE-G2; ADR-0048 §5, §9): the 0086 health_assessment, health_assessment_answer and
 * health_assessment_action guards a request can reach. The API refuses first under the assessment's row lock (and the
 * lock class healthAssessmentSubmit at submission) with the same codes (health/assessments.ts); these are the
 * database's last line (a concurrent writer that passed the API's check first).
 *   health_assessment_one_draft_key, health_assessment_sequence_key -> 409 health_check.draft_exists (two concurrent
 *                                                                    creates: the other one made the draft)
 *   health_assessment_submitted_final, health_assessment_answer_draft_only,
 *   health_assessment_action_draft_only                             -> 422 health_check.not_draft
 *   health_assessment_answer_response_allowed                       -> 422 health_check.response_not_allowed
 *   health_assessment_three_actions                                 -> 422 health_check.actions_required
 *   health_assessment_incomplete                                    -> 422 health_check.incomplete
 *   health_assessment_answer_evidence_fkey                          -> 422 validation.reference (/evidenceId)
 *   health_assessment_action_improvement_fkey                       -> 422 validation.reference (/actions)
 *   health_assessment_score_matches, health_assessment_scheme_published, health_assessment_previous_submitted,
 *   health_assessment_created_draft, health_assessment_scheme_fixed, health_assessment_submitted_complete,
 *   health_assessment_answered_count, health_assessment_answer_key, health_assessment_answer_identity_fixed,
 *   health_assessment_action_rank_key, health_assessment_action_identity_fixed -> 500 (unreachable: the API writes the
 *                                                                    shared result, the pinned published scheme, and
 *                                                                    every child write holds the assessment's row lock)
 */
export function mapP5HealthCheckError(error: PgErrorLike): HttpProblem | null {
  const reference = (pointer: string, message: string) =>
    new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "validation.reference",
      title: "Business rule violated",
      detail: "The referenced record does not exist in this transformation.",
      errors: [{ pointer, code: "validation.reference", message }],
    });
  switch (error.constraint ?? "") {
    case "health_assessment_one_draft_key":
    case "health_assessment_sequence_key":
      return problems.duplicate(
        "health_check.draft_exists",
        "This transformation already has a health check in progress.",
      );
    case "health_assessment_submitted_final":
    case "health_assessment_answer_draft_only":
    case "health_assessment_action_draft_only":
      return problems.businessRule(
        "health_check.not_draft",
        "Only a health check in progress can be changed or submitted.",
      );
    case "health_assessment_answer_response_allowed":
      return problems.businessRule(
        "health_check.response_not_allowed",
        "This response is not allowed by the health check's scoring scheme.",
      );
    case "health_assessment_three_actions":
      return problems.businessRule("health_check.actions_required", "Submit the health check with its top 3 actions.");
    case "health_assessment_incomplete":
      return problems.businessRule(
        "health_check.incomplete",
        "Answer all 25 questions before submitting the health check.",
      );
    case "health_assessment_answer_evidence_fkey":
      return reference("/evidenceId", "No evidence with this id in this transformation.");
    case "health_assessment_action_improvement_fkey":
      return reference("/actions", "No improvement_item with this id in this transformation.");
    case "health_assessment_score_matches":
    case "health_assessment_scheme_published":
    case "health_assessment_previous_submitted":
    case "health_assessment_created_draft":
    case "health_assessment_scheme_fixed":
    case "health_assessment_submitted_complete":
    case "health_assessment_answered_count":
    case "health_assessment_answer_key":
    case "health_assessment_answer_identity_fixed":
    case "health_assessment_action_rank_key":
    case "health_assessment_action_identity_fixed":
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P5 slice J (T-DG5-BE-S; ADR-0050 §1-§6): the 0090 guards of the demo environment tables. mth_app holds SELECT only on
 * deployment_environment, demo_seed_record and demo_dataset_run (the owner-run CLI and the demo reset write them), so
 * the API reaching one of these is a programming error (500), never a user-facing refusal:
 *   deployment_environment_kind_via, deployment_environment_demo_dataset, demo_seed_record_demo_only,
 *   demo_seed_record_ref, demo_seed_record_fixture_key, demo_dataset_run_demo_only, demo_dataset_run_step,
 *   demo_dataset_run_requester, demo_dataset_run_api_reset, demo_dataset_run_run_no_key -> 500
 */
export function mapP5DemoEnvironmentError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "deployment_environment_kind_via":
    case "deployment_environment_demo_dataset":
    case "demo_seed_record_demo_only":
    case "demo_seed_record_ref":
    case "demo_seed_record_fixture_key":
    case "demo_dataset_run_demo_only":
    case "demo_dataset_run_step":
    case "demo_dataset_run_requester":
    case "demo_dataset_run_api_reset":
    case "demo_dataset_run_run_no_key":
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P5 slice I (T-DG5-BE-R; ADR-0049 §8, §11): the 0089 branding guards. The service checks the colours, fonts, logo and
 * text pairs first with the same codes; the two text rules (p5_claims_official_pmi, p5_mentions_engineering_gate) are
 * answered here, and the rest only in a race or by a programming error:
 *   branding_version_no_pmi_claim               -> 422 branding.prohibited_claim
 *   branding_version_no_engineering_gate        -> 422 branding.engineering_gate_reference
 *   branding_version_logo_complete, branding_version_logo_png_check -> 422 branding.logo_invalid
 *   branding_version_primary_colour_check, branding_version_secondary_colour_check -> 422 branding.colour_invalid
 *   branding_version_font_latin_check, branding_version_font_arabic_check -> 422 branding.font_unavailable
 *   branding_version_header_pair, branding_version_footer_pair -> 422 branding.text_pair_required
 *   branding_version_step, branding_version_organization_version_key, branding_setting_organization_key,
 *   branding_setting_current_latest             -> 409 version conflict (two saves raced past the lock's If-Match check)
 *   branding_version_colour_approval, branding_setting_version_matches, branding_setting_current_fkey -> 500
 */
export function mapP5BrandingError(error: PgErrorLike): HttpProblem | null {
  const businessRule = (code: string, detail: string) => problems.businessRule(code, detail);
  switch (error.constraint ?? "") {
    case "branding_version_no_pmi_claim":
      return businessRule(
        "branding.prohibited_claim",
        "Branding text must not claim official PMI status or certification.",
      );
    case "branding_version_no_engineering_gate":
      return businessRule(
        "branding.engineering_gate_reference",
        "Branding text must not name an engineering delivery gate.",
      );
    case "branding_version_logo_complete":
    case "branding_version_logo_png_check":
      return businessRule(
        "branding.logo_invalid",
        "The logo must be a PNG image of at most 256 KiB, with alternative text in English and Arabic.",
      );
    case "branding_version_primary_colour_check":
    case "branding_version_secondary_colour_check":
      return businessRule("branding.colour_invalid", "Colours must be six-digit hexadecimal values such as #0078FF.");
    case "branding_version_font_latin_check":
    case "branding_version_font_arabic_check":
      return businessRule(
        "branding.font_unavailable",
        "Only the bundled fonts IBM Plex Sans and IBM Plex Sans Arabic can be selected.",
      );
    case "branding_version_header_pair":
    case "branding_version_footer_pair":
      return businessRule(
        "branding.text_pair_required",
        "Enter the report header and footer in both English and Arabic, or leave both empty.",
      );
    case "branding_version_step":
    case "branding_version_organization_version_key":
    case "branding_setting_organization_key":
    case "branding_setting_current_latest":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "branding_version_colour_approval":
    case "branding_setting_version_matches":
    case "branding_setting_current_fkey":
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P6 slices E and F (T-DG6-BE-A; p6-work-split §E/F.1, exact; ADR-0051 §2, ADR-0052 §1): the 0098/0099 guards.
 *   sensitive_record_grant_one_active_key                   -> 409 sensitive_grant.duplicate
 *   sensitive_record_grant_not_self                         -> 422 sensitive_grant.not_self
 *   sensitive_record_grant_transition                       -> 422 invalid_transition ("Only an active grant can be revoked.")
 *   record_sensitivity_record_ref, sensitive_record_grant_record_ref -> 404 not_found (the record does not exist in the
 *                                                              transformation; existence is not disclosed)
 *   record_sensitivity_record_key, upload_policy_organization_key -> 409 version_conflict (a concurrent If-Match "0"
 *                                                              create of the same row)
 *   upload_policy_allowed_types, upload_policy_max_bytes    -> 400 validation
 *   inbox_notification_deep_link_once, inbox_notification_link_token_key, evidence_content_detected_type,
 *   evidence_content_detected_media_type                    -> 500: no business code ("unmapped"); the API never sends
 *     values that violate them (BE-C and BE-D prove it). They are named here only because the generic SQLSTATE
 *     fallbacks would otherwise answer 422 validation.constraint (23514) or 409 duplicate (23505) for them.
 */
export function mapP6AccessHardeningError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "sensitive_record_grant_one_active_key":
      return problems.duplicate(
        "sensitive_grant.duplicate",
        "This person already has an active grant for this record.",
      );
    case "sensitive_record_grant_not_self":
      return problems.businessRule("sensitive_grant.not_self", "You cannot grant access to yourself.");
    case "sensitive_record_grant_transition":
      return problems.invalidTransition("Only an active grant can be revoked.");
    case "record_sensitivity_record_ref":
    case "sensitive_record_grant_record_ref":
      return problems.notFound();
    case "record_sensitivity_record_key":
    case "upload_policy_organization_key":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "upload_policy_allowed_types":
      return problems.validation([
        {
          pointer: "/allowedTypes",
          code: "validation.upload_policy_allowed_types",
          message: "Choose one or more of the allowed file types.",
        },
      ]);
    case "upload_policy_max_bytes":
      return problems.validation([
        {
          pointer: "/maxBytes",
          code: "validation.upload_policy_max_bytes",
          message: "The size limit must be between 1 and 26214400 bytes.",
        },
      ]);
    case "inbox_notification_deep_link_once":
    case "inbox_notification_link_token_key":
    case "evidence_content_detected_type":
    case "evidence_content_detected_media_type":
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P6 slices J and C (T-DG6-BE-K; p6-work-split §J/C.3, exact; ADR-0053 §2, ADR-0054 §4): the 0101/0102 guards.
 *   operational_exception_transition                      -> 409 operations.exception_not_open
 *   operational_exception_resolved_final                  -> 409 operations.exception_resolved
 *   service_identity_grant_within_declaration, service_identity_permission_category
 *                                                         -> 422 service_identity.grant_exceeds_declaration
 *   storage_setting_s3_complete                           -> 422 storage.s3_incomplete
 *   storage_setting_access_key_ref, storage_setting_secret_key_ref, notification_channel_username_ref,
 *   notification_channel_password_ref                     -> 422 storage.secret_ref_invalid
 *   notification_channel_email_complete, notification_channel_credentials_pair
 *                                                         -> 422 notification_channel.email_incomplete
 *   notification_channel_no_messaging_adapter             -> 422 notification_channel.adapter_unavailable
 *   storage_setting_singleton_key, notification_channel_kind_key -> 409 version_conflict (a concurrent create)
 * The services refuse first with the same codes; these are the database's last line.
 */
export function mapP6OperationsChannelsError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "operational_exception_transition":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.invalidTransition,
        code: "operations.exception_not_open",
        title: "Invalid transition",
        detail: "Only an open operational exception can be acknowledged.",
      });
    case "operational_exception_resolved_final":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.invalidTransition,
        code: "operations.exception_resolved",
        title: "Invalid transition",
        detail: "This operational exception is already resolved.",
      });
    case "service_identity_grant_within_declaration":
    case "service_identity_permission_category":
      return problems.businessRule(
        "service_identity.grant_exceeds_declaration",
        "A service identity can be granted only permissions that its job or connector declares.",
      );
    case "storage_setting_s3_complete":
      return problems.businessRule(
        "storage.s3_incomplete",
        "The object store needs an endpoint, a region, a bucket and both credential references.",
      );
    case "storage_setting_access_key_ref":
    case "storage_setting_secret_key_ref":
    case "notification_channel_username_ref":
    case "notification_channel_password_ref":
      return problems.businessRule(
        "storage.secret_ref_invalid",
        "A credential must be a reference to a secret (provider and name), never the secret itself.",
      );
    case "notification_channel_email_complete":
    case "notification_channel_credentials_pair":
      return problems.businessRule(
        "notification_channel.email_incomplete",
        "Email needs an SMTP host, a port, a security mode and a sender address.",
      );
    case "notification_channel_no_messaging_adapter":
      return problems.businessRule(
        "notification_channel.adapter_unavailable",
        "No adapter is installed for this channel. In-app notifications continue to work.",
      );
    case "storage_setting_singleton_key":
    case "notification_channel_kind_key":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    default:
      return null;
  }
}

/**
 * P6 slices B and A (T-DG6-BE-L; p6-work-split §B/A.1, exact; ADR-0055 §9, ADR-0056 §9): the 0104-0106 guards. The
 * API checks each rule before it writes, so these are the race and last-line answers.
 *   connector_organization_code_key                                    -> 409 connector.code_taken
 *   connector_config_version_credential_refs, _no_secret_settings      -> 422 connector.secret_value_refused
 *   connector_config_version_field_mappings                            -> 422 connector.mappings_invalid
 *   connector_config_version_adapter_shape, _outbound_test_only,
 *     connector_config_version_adapter_settings_check (the 4 KiB size) -> 422 connector.adapter_settings_invalid
 *   connector_config_version_target_shape                              -> 422 connector.target_invalid
 *   integration_run_one_active                                         -> 409 connector.run_active
 *   integration_run_one_retry_key, integration_run_retry_chain         -> 409 integration_run.not_retryable
 *   outbound_write_idempotency_key                                     -> 409 outbound_write.idempotency_key_reused
 *   outbound_write_action_allowed                                      -> 422 outbound_write.action_not_allowed
 *   outbound_write_final, outbound_write_transition                    -> 409 outbound_write.final
 *   deliverable_external_change_final                                  -> 409 external_change.already_confirmed
 *   deliverable_external_change_evidence_verified                      -> 422 external_change.evidence_not_verified
 *   webhook_endpoint_connector_kind                                    -> 422 webhook.connector_not_webhook
 *   webhook_endpoint_final                                             -> 409 webhook.endpoint_disabled
 *   webhook_receipt_delivery_key                                       -> 409 webhook.delivery_id_reused
 *   import_batch_transition, import_batch_final                        -> 409 import.not_staged
 *   import_batch_counts_match_rows                                     -> 500 (a defect, never a user error)
 * The texts are ADR-0055 §9's and ADR-0056 §9's, English verbatim (the webhook and import ones as ADR-0056 states them).
 */
const IMPORT_NOT_STAGED = "Only a staged import can be committed or cancelled.";
const WEBHOOK_DELIVERY_ID_REUSED = "This delivery id was already used with a different body.";
const WEBHOOK_ENDPOINT_DISABLED = "This webhook endpoint is disabled.";
/** Not in ADR-0056 §9's table (the contract names the code only); proposed in the T-DG6-BE-L handback. */
const WEBHOOK_CONNECTOR_NOT_WEBHOOK = "A webhook endpoint can be created only for a webhook connector.";
const sliceBaConflict = (code: string, detail: string): HttpProblem =>
  new HttpProblem({ status: 409, type: PROBLEM_TYPES.invalidTransition, code, title: "Conflict", detail });
const sliceBaRule = (code: string, detail: string, pointer = ""): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

export function mapP6IntegrationsError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "connector_organization_code_key":
      return problems.duplicate(
        "connector.code_taken",
        "A connector with this code already exists in this organization.",
      );
    case "connector_config_version_credential_refs":
    case "connector_config_version_no_secret_settings":
      return sliceBaRule(
        "connector.secret_value_refused",
        "Credentials are stored only as references to a secret that IT holds. Enter a secret reference, not the secret itself.",
        "/config/credentialRefs",
      );
    case "connector_config_version_field_mappings":
      return sliceBaRule(
        "connector.mappings_invalid",
        "The field mappings are invalid: name each target field once, and give every source column a name.",
        "/config/fieldMappings",
      );
    case "connector_config_version_adapter_shape":
    case "connector_config_version_outbound_test_only":
    case "connector_config_version_adapter_settings_check":
      return sliceBaRule(
        "connector.adapter_settings_invalid",
        "These settings do not fit this connector type.",
        "/config/adapterSettings",
      );
    case "connector_config_version_target_shape":
      return sliceBaRule(
        "connector.target_invalid",
        "Choose a transformation of this organization as the import target.",
        "/config/targetTransformationId",
      );
    case "integration_run_one_active":
      return sliceBaConflict(
        "connector.run_active",
        "A run of this connector is already queued or running. Wait for it to finish.",
      );
    case "integration_run_one_retry_key":
    case "integration_run_retry_chain":
      return sliceBaConflict("integration_run.not_retryable", "Only a failed run can be retried, and only once.");
    case "outbound_write_idempotency_key":
      return problems.duplicate(
        "outbound_write.idempotency_key_reused",
        "This idempotency key was already used for a different request.",
      );
    case "outbound_write_action_allowed":
      return sliceBaRule(
        "outbound_write.action_not_allowed",
        "The connector's current configuration does not allow this action.",
      );
    case "outbound_write_final":
    case "outbound_write_transition":
      return sliceBaConflict("outbound_write.final", "This write is already confirmed or failed and cannot change.");
    case "deliverable_external_change_final":
      return sliceBaConflict(
        "external_change.already_confirmed",
        "This external change is already confirmed. A confirmation never changes.",
      );
    case "deliverable_external_change_evidence_verified":
      return sliceBaRule(
        "external_change.evidence_not_verified",
        "Only reviewed (verified) evidence confirms an external change. A filename-only link never does.",
        "/evidenceId",
      );
    case "webhook_endpoint_connector_kind":
      return sliceBaRule("webhook.connector_not_webhook", WEBHOOK_CONNECTOR_NOT_WEBHOOK, "/connectorId");
    case "webhook_endpoint_final":
      return sliceBaConflict("webhook.endpoint_disabled", WEBHOOK_ENDPOINT_DISABLED);
    case "webhook_receipt_delivery_key":
      return problems.duplicate("webhook.delivery_id_reused", WEBHOOK_DELIVERY_ID_REUSED);
    case "import_batch_transition":
    case "import_batch_final":
      return sliceBaConflict("import.not_staged", IMPORT_NOT_STAGED);
    case "import_batch_counts_match_rows":
      return problems.internal();
    default:
      return null;
  }
}

/**
 * P6 slice H (T-DG6-BE-Q; p6-work-split §H/G.3, exact; ADR-0057 §4, §10): the 0108 saved_view guards. The API checks
 * each rule before it writes (search/saved-views.ts), so these are the race and last-line answers.
 *   saved_view_name_key                                           -> 409 saved_view.name_taken
 *   saved_view_final                                              -> 409 saved_view.deleted
 *   saved_view_owner_only                                         -> 403 saved_view.not_owner
 *   saved_view_columns_valid, _filters_valid, _sort_valid          -> 400 (validation at /columns, /filters, /sort)
 *   saved_view_one_default_key                                    -> 409 saved_view.default_conflict
 *   saved_view_organization_matches,
 *     saved_view_cross_transformation_lists                       -> 404 (the transformation is not the caller's)
 * The texts are ADR-0057 §10's, English verbatim.
 */
export function mapP6SavedViewError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "saved_view_name_key":
      return problems.duplicate("saved_view.name_taken", "You already have a view with this name for this list.");
    case "saved_view_final":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.invalidTransition,
        code: "saved_view.deleted",
        title: "Conflict",
        detail: "This view was deleted.",
      });
    case "saved_view_owner_only":
      return new HttpProblem({
        status: 403,
        type: PROBLEM_TYPES.forbidden,
        code: "saved_view.not_owner",
        title: "Forbidden",
        detail: "Only the person who created this view can change it.",
      });
    case "saved_view_columns_valid":
      return problems.badRequest("validation.format", "The view's columns are not valid.", "/columns");
    case "saved_view_filters_valid":
      return problems.badRequest("validation.format", "The view's filters are not valid.", "/filters");
    case "saved_view_sort_valid":
      return problems.badRequest("validation.format", "The view's sort is not valid.", "/sort");
    case "saved_view_one_default_key":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "saved_view.default_conflict",
        title: "Conflict",
        detail: "Another view was made the default for this list at the same time. Reload the list and try again.",
      });
    case "saved_view_organization_matches":
    case "saved_view_cross_transformation_lists":
      return problems.notFound();
    default:
      return null;
  }
}

/**
 * P6 slice D (T-DG6-BE-T; ADR-0059 §3, §9, §10): the 0111 guards of the assistant tables. The routes refuse first with
 * the same codes (settings.ts, conversations.ts); these are the race and last-line answers.
 *   assistant_setting_singleton_key, assistant_conversation_message_step,
 *   assistant_message_sequence, assistant_message_seq_key            -> 409 version_conflict (a concurrent change)
 *   assistant_setting_enable_complete                                 -> 422 assistant.enable_incomplete
 *   assistant_setting_locked_while_enabled                            -> 422 assistant.locked_while_enabled
 *   assistant_setting_endpoint_url                                    -> 422 assistant.endpoint_invalid
 *   assistant_setting_credential_ref                                  -> 422 assistant.credential_ref_invalid
 *   assistant_setting_test_adapter_shape                              -> 422 assistant.test_adapter_shape (proposed in
 *                                                                        the BE-T handback; not in ADR-0059 §10)
 *   assistant_conversation_message_count_check                        -> 422 assistant.conversation_full
 *   assistant_setting_starts_disabled, assistant_setting_enabled_by_actor, assistant_conversation_owner_only,
 *   assistant_conversation_identity_fixed, assistant_conversation_organization_matches,
 *   assistant_conversation_messages_match, assistant_message_conversation_matches, assistant_message_user_shape,
 *   assistant_message_reply_shape, assistant_message_citations_valid  -> 500 (a defect of the API, never a user error)
 * The texts are ADR-0059 §10's, English verbatim.
 */
export function mapP6AssistantError(error: PgErrorLike): HttpProblem | null {
  switch (error.constraint ?? "") {
    case "assistant_setting_singleton_key":
    case "assistant_conversation_message_step":
    case "assistant_message_sequence":
    case "assistant_message_seq_key":
      return new HttpProblem({
        status: 409,
        type: PROBLEM_TYPES.versionConflict,
        code: "version_conflict",
        title: "Version conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    case "assistant_setting_enable_complete":
      return problems.businessRule(
        "assistant.enable_incomplete",
        "To turn the assistant on, enter the provider, the company authorization reference and, for an HTTP endpoint, the endpoint, the API style and the model.",
      );
    case "assistant_setting_locked_while_enabled":
      return problems.businessRule(
        "assistant.locked_while_enabled",
        "Turn the assistant off before changing its provider, endpoint, API style, model, credential or authorization reference.",
      );
    case "assistant_setting_endpoint_url":
      return problems.businessRule(
        "assistant.endpoint_invalid",
        "Enter the endpoint as an http or https address without a user name, password, query or fragment.",
      );
    case "assistant_setting_credential_ref":
      return problems.businessRule(
        "assistant.credential_ref_invalid",
        "A credential must be a reference to a secret (provider and name), never the secret itself.",
      );
    case "assistant_setting_test_adapter_shape":
      return problems.businessRule(
        "assistant.test_adapter_shape",
        "The test adapter takes no endpoint, API style or credential. Clear them, or choose the HTTP endpoint.",
      );
    case "assistant_conversation_message_count_check":
      return problems.businessRule(
        "assistant.conversation_full",
        "This conversation has reached 100 messages. Start a new conversation.",
      );
    case "assistant_setting_starts_disabled":
    case "assistant_setting_enabled_by_actor":
    case "assistant_conversation_owner_only":
    case "assistant_conversation_identity_fixed":
    case "assistant_conversation_organization_matches":
    case "assistant_conversation_messages_match":
    case "assistant_message_conversation_matches":
    case "assistant_message_user_shape":
    case "assistant_message_reply_shape":
    case "assistant_message_citations_valid":
      return problems.internal();
    default:
      return null;
  }
}

export function mapDatabaseGuardError(error: PgErrorLike): HttpProblem | null {
  const code = error.code;
  if (code === undefined || !SQLSTATE.test(code)) return null;
  const constraint = error.constraint ?? "";

  const p4Meetings = mapP4GovernanceMeetingError(error);
  if (p4Meetings !== null) return p4Meetings;
  const p5Studio = mapP5StudioError(error); // P5 slice A (T-DG5-BE-A; ADR-0039 §13, ADR-0040 §8)
  if (p5Studio !== null) return p5Studio;
  const p5Automation = mapP5AutomationError(error); // P5 slice D (T-DG5-BE-H; ADR-0043 §9)
  if (p5Automation !== null) return p5Automation;
  const p5Report = mapP5ReportError(error); // P5 slice F (T-DG5-KBE-C; ADR-0045 §11)
  if (p5Report !== null) return p5Report;
  const p5OwnerUpdate = mapP5OwnerUpdateError(error); // P5 slice F (T-DG5-KBE-D; ADR-0045 §11)
  if (p5OwnerUpdate !== null) return p5OwnerUpdate;
  const p5Export = mapP5ExportError(error); // P5 slice F (T-DG5-BE-M; ADR-0046 §8)
  if (p5Export !== null) return p5Export;
  const p5PlaybookBlock = mapP5PlaybookBlockError(error); // P5 slice I (T-DG5-BE-Q; ADR-0049 §1, §4)
  if (p5PlaybookBlock !== null) return p5PlaybookBlock;
  const p5MethodologyReader = mapP5MethodologyReaderError(error); // P5 slice I (T-DG5-BE-Q2; ADR-0049 §6, §11)
  if (p5MethodologyReader !== null) return p5MethodologyReader;
  const p5CutoffPack = mapP5CutoffPackError(error); // P5 slice E (T-DG5-BE-C2, D-155 (c); ADR-0044 §6, §10)
  if (p5CutoffPack !== null) return p5CutoffPack;
  const p5LaunchPlan = mapP5LaunchPlanError(error); // P5 slice H (T-DG5-BE-P; ADR-0048 §9)
  if (p5LaunchPlan !== null) return p5LaunchPlan;
  const p5DayNinety = mapP5DayNinetyError(error); // P5 slice H (T-DG5-BE-P2; ADR-0048 §9)
  if (p5DayNinety !== null) return p5DayNinety;
  const p5KpiRestatement = mapP5KpiRestatementError(error); // P5 slice G (T-DG5-KBE-E; ADR-0047 §8)
  if (p5KpiRestatement !== null) return p5KpiRestatement;
  const p5FinancialMetric = mapP5FinancialMetricError(error); // P5 slice G (T-DG5-KBE-F; ADR-0047 §8)
  if (p5FinancialMetric !== null) return p5FinancialMetric;
  const p5HealthScheme = mapP5HealthSchemeError(error); // P5 slice H (T-DG5-KBE-G; ADR-0048 §9)
  if (p5HealthScheme !== null) return p5HealthScheme;
  const p5HealthCheck = mapP5HealthCheckError(error); // P5 slice H (T-DG5-KBE-G2; ADR-0048 §9)
  if (p5HealthCheck !== null) return p5HealthCheck;
  const p5DemoEnvironment = mapP5DemoEnvironmentError(error); // P5 slice J (T-DG5-BE-S; ADR-0050 §1-§6)
  if (p5DemoEnvironment !== null) return p5DemoEnvironment;
  const p5Branding = mapP5BrandingError(error); // P5 slice I (T-DG5-BE-R; ADR-0049 §8, §11)
  if (p5Branding !== null) return p5Branding;
  const p6AccessHardening = mapP6AccessHardeningError(error); // P6 slices E/F (T-DG6-BE-A; ADR-0051 §2, ADR-0052 §1)
  if (p6AccessHardening !== null) return p6AccessHardening;
  const p6OperationsChannels = mapP6OperationsChannelsError(error); // P6 slices J/C (T-DG6-BE-K; ADR-0053 §2, ADR-0054 §4)
  if (p6OperationsChannels !== null) return p6OperationsChannels;
  const p6Integrations = mapP6IntegrationsError(error); // P6 slices B/A (T-DG6-BE-L; ADR-0055 §9, ADR-0056 §9)
  if (p6Integrations !== null) return p6Integrations;
  const p6SavedView = mapP6SavedViewError(error); // P6 slice H (T-DG6-BE-Q; ADR-0057 §4, §10)
  if (p6SavedView !== null) return p6SavedView;
  const p6Assistant = mapP6AssistantError(error); // P6 slice D (T-DG6-BE-T; ADR-0059 §10)
  if (p6Assistant !== null) return p6Assistant;
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
  const p4AdoptionSustainment = mapP4AdoptionSustainmentError(error);
  if (p4AdoptionSustainment !== null) return p4AdoptionSustainment;
  const p4SustainmentArea = mapP4SustainmentAreaError(error); // BE-I (slices F/G block)
  if (p4SustainmentArea !== null) return p4SustainmentArea;
  const p4SustainmentOperations = mapP4SustainmentOperationsError(error); // BE-I2 (slices F/G block)
  if (p4SustainmentOperations !== null) return p4SustainmentOperations;
  const p4SustainmentClosure = mapP4SustainmentClosureError(error); // BE-J (slices F/G block)
  if (p4SustainmentClosure !== null) return p4SustainmentClosure;
  const p4GateScale = mapP4GateScaleError(error); // BE-K (slice H block)
  if (p4GateScale !== null) return p4GateScale;
  const p4GateReviewException = mapP4GateReviewExceptionError(error); // BE-K2 (slice H block)
  if (p4GateReviewException !== null) return p4GateReviewException;
  const p4ChangeControl = mapP4ChangeControlError(error); // BE-L (slice H block)
  if (p4ChangeControl !== null) return p4ChangeControl;
  const p4Traceability = mapP4TraceabilityError(error); // BE-M (slices J/K block)
  if (p4Traceability !== null) return p4Traceability;
  const p4ModularEntry = mapP4ModularEntryError(error); // BE-M2 (slices J/K block)
  if (p4ModularEntry !== null) return p4ModularEntry;
  const p4Structure = mapP4StructureError(error); // BE-M3 (slices J/K block)
  if (p4Structure !== null) return p4Structure;
  const p4Dashboard = mapP4DashboardError(error); // KBE-G (slices J/K block)
  if (p4Dashboard !== null) return p4Dashboard;
  const p4PhaseStep = mapP4PhaseStepError(error); // BE-L2 (slice H block)
  if (p4PhaseStep !== null) return p4PhaseStep;
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
