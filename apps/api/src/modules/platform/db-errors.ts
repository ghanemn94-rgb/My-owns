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
 * Maps a P2 database guard or template-constraint error to a problem, or null when the error is not one of them (the
 * generic mapping in hooks.ts then applies).
 */
export function mapDatabaseGuardError(error: PgErrorLike): HttpProblem | null {
  const code = error.code;
  if (code === undefined || !SQLSTATE.test(code)) return null;
  const constraint = error.constraint ?? "";

  const p4Meetings = mapP4GovernanceMeetingError(error);
  if (p4Meetings !== null) return p4Meetings;
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
  const p4ChangeControl = mapP4ChangeControlError(error); // BE-L (slice H block)
  if (p4ChangeControl !== null) return p4ChangeControl;
  const p4Dashboard = mapP4DashboardError(error); // KBE-G (slices J/K block)
  if (p4Dashboard !== null) return p4Dashboard;
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
