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
