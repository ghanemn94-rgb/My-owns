#!/usr/bin/env python3
"""T-DG4-ARCH-03: generates the slice B OpenAPI additions (ADR-0029, ADR-0030) and inserts them into
docs/api/openapi.yaml. Provenance only: run once by the solution-architect; the YAML file is the contract.
The op()/render_paths()/render_params()/page() helpers are copied from the T-DG4-ARCH-02 generator, with one addition:
conflict= names a custom 409 response.

  python3 docs/delivery/handbacks/DG4/T-DG4-ARCH-03-evidence/openapi-p4-arch03.py docs/api/openapi.yaml

Every operation declares the ADR-0007 §5b statuses: 400, 401 (non-public), 403 (when it needs a permission or a
record-level right), 404 (path ids), 409/428 (If-Match), 422 (business rules) and 429; problem+json errors;
ETag on single-resource responses; Cursor/Limit on paginated lists.
"""
import sys

R = lambda name: '{ $ref: "#/components/responses/%s" }' % name  # noqa: E731

OPS = []


def op(path, method, op_id, tag, summary, *, params=(), query=(), body=None, ok="200", ok_desc="OK.", ok_schema=None,
       etag=False, location=False, if_match=False, forbidden=True, not_found=True, rule=True, dup=False, conflict=None):
    OPS.append(dict(path=path, method=method, id=op_id, tag=tag, summary=summary, params=params, query=query, body=body,
                    ok=ok, ok_desc=ok_desc, ok_schema=ok_schema, etag=etag, location=location, if_match=if_match,
                    forbidden=forbidden, not_found=not_found, rule=rule, dup=dup, conflict=conflict))


def render_paths():
    by_path = {}
    for o in OPS:
        by_path.setdefault(o["path"], []).append(o)
    out = []
    for path, ops in by_path.items():
        out.append(f"  {path}:")
        pp = ops[0]["params"]
        if pp:
            out.append("    parameters:")
            for p in pp:
                out.append(f'      - $ref: "#/components/parameters/{p}"')
        for o in ops:
            out.append(f"    {o['method']}:")
            out.append(f"      tags: [{o['tag']}]")
            out.append(f"      operationId: {o['id']}")
            out.append(f'      summary: "{o["summary"]}"')
            unsafe = o["method"] != "get"
            if unsafe:
                out.append("      security:")
                out.append("        - sessionCookie: []")
                out.append("          csrfToken: []")
            qp = list(o["query"]) + (["IfMatch"] if o["if_match"] else [])
            if qp:
                out.append("      parameters:")
                for p in qp:
                    out.append(f'        - $ref: "#/components/parameters/{p}"')
            if o["body"]:
                out.append("      requestBody:")
                out.append("        required: true")
                out.append("        content:")
                out.append("          application/json:")
                out.append(f'            schema: {{ $ref: "#/components/schemas/{o["body"]}" }}')
            out.append("      responses:")
            out.append(f'        "{o["ok"]}":')
            out.append(f'          description: "{o["ok_desc"]}"')
            if o["etag"] or o["location"]:
                out.append("          headers:")
                if o["location"]:
                    out.append('            Location: { $ref: "#/components/headers/Location" }')
                if o["etag"]:
                    out.append('            ETag: { $ref: "#/components/headers/ETag" }')
            out.append("          content:")
            out.append("            application/json:")
            out.append(f'              schema: {{ $ref: "#/components/schemas/{o["ok_schema"]}" }}')
            out.append(f'        "400": {R("ValidationError")}')
            out.append(f'        "401": {R("Unauthenticated")}')
            if o["forbidden"] or unsafe:
                out.append(f'        "403": {R("Forbidden")}')
            if o["not_found"]:
                out.append(f'        "404": {R("NotFound")}')
            if o["conflict"]:
                out.append(f'        "409": {R(o["conflict"])}')
            elif o["if_match"]:
                out.append(f'        "409": {R("VersionConflict")}')
            elif o["dup"]:
                out.append(f'        "409": {R("Duplicate")}')
            if o["rule"] or unsafe:
                out.append(f'        "422": {R("BusinessRule")}')
            if o["if_match"]:
                out.append(f'        "428": {R("PreconditionRequired")}')
            out.append(f'        "429": {R("RateLimited")}')
    return "\n".join(out) + "\n"


T = "/api/v1/transformations/{transformationId}"
TP = ["TransformationId"]
B = T + "/benefits/{benefitId}"
BP = ["TransformationId", "BenefitId"]

# ----------------------------------------------------------------------------------------------- benefits (ADR-0029 §1-§4, §8)
op(T + "/benefits", "get", "listBenefits", "benefits",
   "The T14 Benefits Register (REQ-PB-075): one row per canonical benefit with the ten T14 columns; Value (SAR) is n/a for a non-financial benefit and Unknown when missing, never 0; Realized keeps validated, sustained and pending apart (transformation.read).",
   params=TP, query=["Cursor", "Limit", "BenefitLifecycleStepQuery", "BenefitStatusQuery"], ok_schema="BenefitRegisterPage", forbidden=False, rule=False)
op(T + "/benefits", "post", "createBenefit", "benefits",
   "Create a benefit at the Identify step (benefit.edit; TL, BO). One owner (ownerUserId; a body with two owners is 400). 422 benefit.mapping_required, benefit.kpi_required, benefit.type_class_mismatch, benefit.valuation_method_required, benefit.valuation_method_not_approved, benefit.kpi_variable_unbound, benefit.validator_is_owner, benefit.parent_depth, benefit.parent_has_values, benefit.parent_currency, benefit.case_line_invalid; 409 benefit.case_line_taken. Runs the overlap rule (ADR-0029 §7).",
   params=TP, body="BenefitCreate", ok="201", ok_desc="Created (Identify).", ok_schema="Benefit", etag=True, location=True, dup=True)
op(B, "get", "getBenefit", "benefits", "Read one benefit with its profile, lifecycle step, counting status and realization state (transformation.read).",
   params=BP, ok_schema="Benefit", etag=True, forbidden=False, rule=False)
op(B, "patch", "updateBenefit", "benefits",
   "Change a benefit's profile and step outputs (benefit.edit). Changing a Finance-validated baseline resets its validation to unvalidated. 422 the createBenefit rules and benefit.measure_locked, benefit.plan_outputs_missing (clearing a Plan output after Plan), benefit_group.counted_member_leaving, benefit.archived.",
   params=BP, body="BenefitUpdate", ok_schema="Benefit", etag=True, if_match=True)
op(B + "/archive", "post", "archiveBenefit", "benefits", "Archive a benefit with a reason (benefit.edit); it is no longer counted. 422 benefit.archived.",
   params=BP, body="ReasonRequest", ok_schema="Benefit", etag=True, if_match=True)
op(B + "/lifecycle", "get", "getBenefitLifecycle", "benefits",
   "The six B0121 steps (question and output, en and provisional ar), which preconditions the benefit meets for each step, and its step history (transformation.read).",
   params=BP, ok_schema="BenefitLifecycle", etag=True, forbidden=False, rule=False)
op(B + "/lifecycle", "post", "advanceBenefitLifecycle", "benefits",
   "Move the benefit one lifecycle step (benefit.advance; BO). 422 benefit.lifecycle_step, benefit.plan_outputs_missing, benefit.enablers_missing, benefit.recovery_plan_required, benefit.sustain_outputs_missing, benefit.archived.",
   params=BP, body="BenefitLifecycleAdvance", ok_schema="Benefit", etag=True, if_match=True)
op(B + "/baseline-validation", "post", "decideBenefitBaseline", "benefits",
   "Finance validates or rejects the benefit's baseline, the comparison basis of its values (finance.validate; FIN only; REQ-PB-013, REQ-S08-008). 403 benefit.baseline_validator_is_owner; 422 benefit.baseline_missing, benefit.baseline_note_required.",
   params=BP, body="BenefitBaselineDecision", ok_schema="Benefit", etag=True, if_match=True)
op(B + "/enablers", "get", "listBenefitEnablers", "benefits", "The benefit dependency chain (Enable output) with each enabler's delivered flag (transformation.read).",
   params=BP, query=["Cursor", "Limit"], ok_schema="BenefitEnablerPage", forbidden=False, rule=False)
op(B + "/enablers", "post", "createBenefitEnabler", "benefits",
   "Link an enabling initiative, optionally one of its deliverables or a capability (benefit.edit). A delivered enabler is never realized value. 422 benefit_enabler.deliverable_initiative, benefit.archived; 409 benefit_enabler.exists.",
   params=BP, body="BenefitEnablerCreate", ok="201", ok_desc="Created.", ok_schema="BenefitEnabler", etag=True, location=True, dup=True)
op(T + "/benefit-enablers/{benefitEnablerId}/remove", "post", "removeBenefitEnabler", "benefits",
   "Remove an enabler link with a reason (benefit.edit). Final. 422 benefit_enabler.removed.",
   params=["TransformationId", "BenefitEnablerId"], body="ReasonRequest", ok_schema="BenefitEnabler", etag=True, if_match=True)
op(B + "/values", "get", "getBenefitValues", "benefits",
   "The benefit's value series kept apart by state: planned, forecast, measured, submitted (pending), validated, rejected and sustained (REQ-S08-001), each with its lines, count and total; never added together (transformation.read).",
   params=BP, ok_schema="BenefitValues", forbidden=False, rule=False)
op(B + "/plan-values", "post", "createBenefitPlanValue", "benefits",
   "Add a planned or forecast value for a period (benefit.edit). 422 benefit_value.currency_mismatch, benefit_value.unmonetised, benefit_value.parent_rollup, benefit.archived; 409 benefit_value.period_taken.",
   params=BP, body="BenefitPlanValueCreate", ok="201", ok_desc="Created.", ok_schema="BenefitPlanValue", etag=True, location=True, dup=True)
op(T + "/benefit-plan-values/{benefitPlanValueId}", "patch", "updateBenefitPlanValue", "benefits",
   "Change a planned or forecast value (benefit.edit). Same refusals as createBenefitPlanValue.",
   params=["TransformationId", "BenefitPlanValueId"], body="BenefitPlanValueUpdate", ok_schema="BenefitPlanValue", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- allocations (ADR-0029 §5)
op(B + "/allocations", "get", "getBenefitAllocations", "benefit-allocations",
   "The allocation set in force: shares per initiative, the allocated share and the unallocated share (1 - sum; REQ-S08-013) (transformation.read).",
   params=BP, ok_schema="BenefitAllocations", etag=True, forbidden=False, rule=False)
op(B + "/allocations", "put", "replaceBenefitAllocations", "benefit-allocations",
   "Replace the benefit's allocation set (benefit.allocate; TL, BO; If-Match = the benefit's ETag). Shares are fractions; above 1 (100 %) in total is refused; below 1 the rest is unallocated. Totals count the benefit once, never its allocations. 422 benefit_allocation.over_100, benefit_allocation.duplicate_initiative, benefit_allocation.share_invalid, benefit.archived.",
   params=BP, body="BenefitAllocationsReplace", ok_schema="BenefitAllocations", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- groups (ADR-0029 §6)
op(T + "/benefit-groups", "get", "listBenefitGroups", "benefit-groups", "Shared-benefit groups with their members and counted member (transformation.read).",
   params=TP, query=["Cursor", "Limit"], ok_schema="BenefitGroupPage", forbidden=False, rule=False)
op(T + "/benefit-groups", "post", "createBenefitGroup", "benefit-groups", "Create a shared-benefit group (benefit_group.manage; TL, BO). Until a counted member is named, no member is counted.",
   params=TP, body="BenefitGroupCreate", ok="201", ok_desc="Created.", ok_schema="BenefitGroup", etag=True, location=True)
op(T + "/benefit-groups/{benefitGroupId}", "get", "getBenefitGroup", "benefit-groups", "Read one group (transformation.read).",
   params=["TransformationId", "BenefitGroupId"], ok_schema="BenefitGroup", etag=True, forbidden=False, rule=False)
op(T + "/benefit-groups/{benefitGroupId}", "patch", "updateBenefitGroup", "benefit-groups",
   "Rename a group or name its counted member (benefit_group.manage). Members join or leave through updateBenefit (benefitGroupId). 422 benefit_group.counted_not_member.",
   params=["TransformationId", "BenefitGroupId"], body="BenefitGroupUpdate", ok_schema="BenefitGroup", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- overlaps (ADR-0029 §7)
op(T + "/benefit-overlaps", "get", "listBenefitOverlaps", "benefit-overlaps", "Overlap warnings (same driver, population or period), open first (transformation.read).",
   params=TP, query=["Cursor", "Limit", "BenefitOverlapStatusQuery"], ok_schema="BenefitOverlapPage", forbidden=False, rule=False)
op(T + "/benefit-overlaps", "post", "createBenefitOverlap", "benefit-overlaps",
   "Raise an overlap warning between two benefits (benefit.edit); both stay out of validated totals until Finance resolves it, and a Finance task is created. 422 benefit_overlap.same_benefit; 409 benefit_overlap.already_open.",
   params=TP, body="BenefitOverlapCreate", ok="201", ok_desc="Created (open).", ok_schema="BenefitOverlap", etag=True, location=True, dup=True)
op(T + "/benefit-overlaps/{benefitOverlapId}", "get", "getBenefitOverlap", "benefit-overlaps", "Read one overlap warning (transformation.read).",
   params=["TransformationId", "BenefitOverlapId"], ok_schema="BenefitOverlap", etag=True, forbidden=False, rule=False)
op(T + "/benefit-overlaps/{benefitOverlapId}/resolve", "post", "resolveBenefitOverlap", "benefit-overlaps",
   "Finance resolves the overlap: no_economic_overlap (both count) or duplicate (the excluded benefit is never counted) (finance.validate; FIN only; REQ-S08-014). 403 benefit_overlap.resolver_is_owner; 422 benefit_overlap.not_open, benefit_overlap.excluded_required, benefit_overlap.note_required.",
   params=["TransformationId", "BenefitOverlapId"], body="BenefitOverlapResolve", ok_schema="BenefitOverlap", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- scenarios (ADR-0029 §10)
op(T + "/benefit-scenarios", "get", "listBenefitScenarios", "benefit-scenarios", "Base, upside and downside scenarios (transformation.read). Scenario values are never actuals.",
   params=TP, query=["Cursor", "Limit"], ok_schema="BenefitScenarioPage", forbidden=False, rule=False)
op(T + "/benefit-scenarios", "post", "createBenefitScenario", "benefit-scenarios", "Create a scenario (benefit_scenario.edit; TL, FIN). 409 benefit_scenario.kind_exists.",
   params=TP, body="BenefitScenarioCreate", ok="201", ok_desc="Created.", ok_schema="BenefitScenario", etag=True, location=True, dup=True)
op(T + "/benefit-scenarios/{benefitScenarioId}", "get", "getBenefitScenario", "benefit-scenarios", "Read one scenario with its labelled values (transformation.read).",
   params=["TransformationId", "BenefitScenarioId"], ok_schema="BenefitScenario", etag=True, forbidden=False, rule=False)
op(T + "/benefit-scenarios/{benefitScenarioId}", "patch", "updateBenefitScenario", "benefit-scenarios", "Rename a scenario, change its assumptions or archive it with a reason (benefit_scenario.edit).",
   params=["TransformationId", "BenefitScenarioId"], body="BenefitScenarioUpdate", ok_schema="BenefitScenario", etag=True, if_match=True)
op(T + "/benefit-scenarios/{benefitScenarioId}/values", "post", "createBenefitScenarioValue", "benefit-scenarios",
   "Add a scenario value for a benefit and period (benefit_scenario.edit). 422 benefit_value.currency_mismatch, benefit_value.unmonetised, benefit_value.parent_rollup; 409 benefit_value.period_taken.",
   params=["TransformationId", "BenefitScenarioId"], body="BenefitScenarioValueCreate", ok="201", ok_desc="Created.", ok_schema="BenefitScenarioValue", etag=True, location=True, dup=True)
op(T + "/benefit-scenario-values/{benefitScenarioValueId}", "patch", "updateBenefitScenarioValue", "benefit-scenarios",
   "Change a scenario value (benefit_scenario.edit). Same refusals as createBenefitScenarioValue.",
   params=["TransformationId", "BenefitScenarioValueId"], body="BenefitScenarioValueUpdate", ok_schema="BenefitScenarioValue", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- valuation methods (ADR-0029 §8)
op(T + "/benefit-valuation-methods", "get", "listBenefitValuationMethods", "benefit-valuation-methods", "Valuation methods for non-financial benefits (transformation.read).",
   params=TP, query=["Cursor", "Limit"], ok_schema="BenefitValuationMethodPage", forbidden=False, rule=False)
op(T + "/benefit-valuation-methods", "post", "createBenefitValuationMethod", "benefit-valuation-methods",
   "Propose a valuation method (benefit.edit); it values a non-financial benefit only after Finance approves it (REQ-S08-010).",
   params=TP, body="BenefitValuationMethodCreate", ok="201", ok_desc="Created (proposed).", ok_schema="BenefitValuationMethod", etag=True, location=True)
op(T + "/benefit-valuation-methods/{benefitValuationMethodId}/decision", "post", "decideBenefitValuationMethod", "benefit-valuation-methods",
   "Finance approves, rejects or retires a valuation method (finance.validate; FIN only; not the proposer). 403 benefit_valuation_method.decider_is_proposer; 422 benefit_valuation_method.not_proposed, benefit_valuation_method.note_required.",
   params=["TransformationId", "BenefitValuationMethodId"], body="BenefitValuationMethodDecision", ok_schema="BenefitValuationMethod", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- measurements (ADR-0030 §2-§5)
op(B + "/measurements", "get", "listBenefitMeasurements", "benefit-measurements", "Measurements of a benefit with their status, corrections and basis (validated or provisional), newest first (transformation.read).",
   params=BP, query=["Cursor", "Limit"], ok_schema="BenefitMeasurementPage", forbidden=False, rule=False)
op(B + "/measurements", "post", "createBenefitMeasurement", "benefit-measurements",
   "Record a measurement for a period, as a draft or submitted (submit: true) with evidence (benefit.measure; BO, WL, KDS). A submitted value is pending: it never changes the validated total before Finance approves it, and one Finance queue item follows (REQ-S12-014). 422 benefit_measurement.step, benefit_measurement.period_required, benefit_measurement.value_shape, benefit_measurement.evidence_required, benefit_measurement.lineage_period, benefit_value.currency_mismatch, benefit_value.unmonetised, benefit_value.parent_rollup, formula.* (ADR-0024 §6); 409 benefit_measurement.period_taken.",
   params=BP, body="BenefitMeasurementCreate", ok="201", ok_desc="Created.", ok_schema="BenefitMeasurement", etag=True, location=True, dup=True)
op(T + "/benefit-measurements/{benefitMeasurementId}", "get", "getBenefitMeasurement", "benefit-measurements",
   "Read one measurement with its lineage (formula version, input KPI actual versions, rates and variables, assumptions, period), evidence and Finance validation (transformation.read; REQ-S08-006).",
   params=["TransformationId", "BenefitMeasurementId"], ok_schema="BenefitMeasurement", etag=True, forbidden=False, rule=False)
op(T + "/benefit-measurements/{benefitMeasurementId}", "patch", "updateBenefitMeasurement", "benefit-measurements",
   "Change a draft measurement (benefit.measure). A validated value is never edited in place: 409 benefit_measurement.validated_immutable (REQ-S08-017; use an amendment or reversal). 422 benefit_measurement.not_draft and the createBenefitMeasurement rules.",
   params=["TransformationId", "BenefitMeasurementId"], body="BenefitMeasurementUpdate", ok_schema="BenefitMeasurement", etag=True, if_match=True, conflict="BenefitValueConflict")
op(T + "/benefit-measurements/{benefitMeasurementId}/submit", "post", "submitBenefitMeasurement", "benefit-measurements",
   "Submit a draft measurement for Finance validation (benefit.measure). Writes one benefit.evidence_submitted event; the worker creates exactly one Finance queue item (REQ-S12-014). 422 benefit_measurement.not_draft, benefit_measurement.period_required, benefit_measurement.evidence_required.",
   params=["TransformationId", "BenefitMeasurementId"], ok_schema="BenefitMeasurement", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- Finance validation (ADR-0030 §3-§4)
F = T + "/finance-validations"
FP = ["TransformationId", "FinanceValidationId"]
op(F, "get", "listFinanceValidationQueue", "finance-validations",
   "The Finance validation queue and its decided items, queued first, oldest first (transformation.read). Each item shows the six items of REQ-S08-015.",
   params=TP, query=["Cursor", "Limit", "FinanceValidationStatusQuery"], ok_schema="FinanceValidationPage", forbidden=False, rule=False)
op(F + "/{financeValidationId}", "get", "getFinanceValidation", "finance-validations", "Read one queue item or decision with its content snapshot and corrections (transformation.read).",
   params=FP, ok_schema="FinanceValidation", etag=True, forbidden=False, rule=False)
op(F + "/{financeValidationId}/decision", "post", "decideFinanceValidation", "finance-validations",
   "Approve or reject a queued value with a decision on each of the six items (finance.validate; FIN only: a Business Owner, an auditor or an ADM-only user gets 403; REQ-PB-013). Approval raises the validated total by exactly approvedAmount. The audit event records the validator. 403 finance_validation.sod_submitter; 422 finance_validation.content_incomplete, finance_validation.not_queued, finance_validation.items_not_accepted, finance_validation.rejection_note_required, finance_validation.approved_amount_required, finance_validation.basis_provisional.",
   params=FP, body="FinanceValidationDecision", ok_schema="FinanceValidation", etag=True, if_match=True)
op(F + "/{financeValidationId}/amendments", "post", "amendFinanceValidation", "finance-validations",
   "Record an amendment of an approved value, linked to the original (finance.validate; REQ-S08-017). The original stays visible; the amendment carries the signed difference. 422 finance_validation.not_approved, finance_validation.already_reversed, finance_validation.reason_required, finance_validation.amendment_unchanged.",
   params=FP, body="FinanceValidationAmendment", ok="201", ok_desc="Created (approved amendment).", ok_schema="FinanceValidation", etag=True, location=True, if_match=True)
op(F + "/{financeValidationId}/reversals", "post", "reverseFinanceValidation", "finance-validations",
   "Reverse an approved value, linked to the original; the reversal nets the total to zero and both records remain visible (finance.validate; REQ-S08-017). 422 finance_validation.not_approved, finance_validation.already_reversed, finance_validation.reason_required.",
   params=FP, body="ReasonRequest", ok="201", ok_desc="Created (approved reversal).", ok_schema="FinanceValidation", etag=True, location=True, if_match=True)

# ----------------------------------------------------------------------------------------------- totals (ADR-0030 §7)
op(T + "/benefit-totals", "get", "getBenefitTotals", "benefit-totals",
   "Benefit totals of the transformation, counted once: per currency, one line per value class and state (planned, forecast, measured, submitted, validated, sustained, rejected), pending-overlap lines, gross, implementation cost (each business-case cost line once) and net; non-financial benefits without a valuation method are counted, never summed as 0. initiativeId gives that initiative's allocated view (transformation.read).",
   params=TP, query=["BenefitInitiativeIdQuery"], ok_schema="BenefitTotals", forbidden=False, rule=False)
op("/api/v1/organizations/{organizationId}/benefit-totals", "get", "getPortfolioBenefitTotals", "benefit-totals",
   "Portfolio totals over the organization's transformations that the caller may read; each benefit counted once (organization.read and transformation.read per transformation).",
   params=["OrganizationId"], ok_schema="BenefitTotals", forbidden=False, rule=False)


UUID = '{ $ref: "#/components/schemas/Uuid" }'
PARAMS = {
    "BenefitId": ("benefitId", "path", UUID),
    "BenefitEnablerId": ("benefitEnablerId", "path", UUID),
    "BenefitPlanValueId": ("benefitPlanValueId", "path", UUID),
    "BenefitGroupId": ("benefitGroupId", "path", UUID),
    "BenefitOverlapId": ("benefitOverlapId", "path", UUID),
    "BenefitScenarioId": ("benefitScenarioId", "path", UUID),
    "BenefitScenarioValueId": ("benefitScenarioValueId", "path", UUID),
    "BenefitValuationMethodId": ("benefitValuationMethodId", "path", UUID),
    "BenefitMeasurementId": ("benefitMeasurementId", "path", UUID),
    "FinanceValidationId": ("financeValidationId", "path", UUID),
    "BenefitLifecycleStepQuery": ("lifecycleStep", "query", '{ $ref: "#/components/schemas/BenefitLifecycleStep" }'),
    "BenefitStatusQuery": ("status", "query", "{ type: string, enum: [active, archived] }"),
    "BenefitOverlapStatusQuery": ("status", "query", "{ type: string, enum: [open, resolved] }"),
    "FinanceValidationStatusQuery": ("status", "query", "{ type: string, enum: [queued, approved, rejected, withdrawn] }"),
    "BenefitInitiativeIdQuery": ("initiativeId", "query", UUID),
}
def render_params():
    out = []
    for key, spec in PARAMS.items():
        name, where, schema = spec[0], spec[1], spec[2]
        required = where == "path" or (len(spec) > 3 and spec[3])
        out.append(f"    {key}:")
        out.append(f"      name: {name}")
        out.append(f"      in: {where}")
        out.append(f"      required: {'true' if required else 'false'}")
        out.append(f"      schema: {schema}")
    return "\n".join(out) + "\n"

def page(name, item):
    return f'''    {name}:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: {{ type: array, items: {{ $ref: "#/components/schemas/{item}" }} }}
        nextCursor: {{ type: [string, "null"] }}
'''


SCHEMAS = r'''
    # ---- P4 slice B (T-DG4-ARCH-03; ADR-0029, ADR-0030) -------------------------------------------------------------
    BenefitType:
      type: string
      enum: [revenue, cost, working_capital, cx, risk, strategic, other]
      description: T14 Type (B0123).
    BenefitValueClass:
      type: string
      enum: [revenue_uplift, margin_uplift, cash_saving, avoided_cost, working_capital_release, non_financial]
      description: "The value class (REQ-S08-009): revenue uplift vs margin and avoided cost vs cash savings are separate classes, never converted. revenue -> revenue_uplift | margin_uplift; cost -> cash_saving | avoided_cost; working_capital -> working_capital_release; risk -> avoided_cost | non_financial; cx, strategic, other -> non_financial."
    BenefitLifecycleStep:
      type: string
      enum: [identify, plan, enable, measure, correct, sustain]
      description: The six B0121 steps (REQ-PB-074).
    BenefitValueState:
      type: string
      enum: [planned, forecast, measured, submitted, validated, sustained, rejected]
      description: One value state (REQ-S08-001). A total is always for one state; states are never added together.
    BenefitAmount:
      type: object
      required: [status, amount, currency, reason]
      additionalProperties: false
      description: A money value with its status. not_applicable = Value (SAR) n/a of a non-financial benefit; unknown = missing, never 0.
      properties:
        status: { type: string, enum: [known, unknown, not_applicable] }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        currency: { oneOf: [{ $ref: "#/components/schemas/Currency" }, { type: "null" }] }
        reason: { type: [string, "null"], description: "i18n key when status is unknown (e.g. benefit.cost_amount_missing)." }
    BenefitCountingStatus:
      type: object
      required: [counted, exclusionReason, overlapOpen]
      additionalProperties: false
      properties:
        counted: { type: boolean, description: "True when the benefit's values may enter a total (ADR-0029 §6)." }
        exclusionReason: { type: [string, "null"], enum: [archived, parent_rollup, group_counted_member_not_named, group_member_not_counted, overlap_duplicate, null] }
        overlapOpen: { type: boolean, description: "An open overlap warning keeps the benefit's values out of validated totals until Finance resolves it." }
    Benefit:
      type: object
      description: A canonical benefit (Benefit, REQ-S16-017) with the REQ-S08-003 profile. Money is a decimal string; NULL is Unknown (financial) or n/a (non-financial), never 0.
      required: [id, transformationId, code, title, description, benefitType, valueClass, ownerUserId, financeValidatorUserId, financeValidationRequired, financialStatementLine, measurementKpiDefinitionId, measurementKpiVariable, businessCaseLineId, benefitFormulaId, baselineId, baselineValue, baselineUnit, baselineDate, counterfactual, baselineValidationStatus, baselineValidatedBy, baselineValidatedAt, baselineValidationNote, driverKey, driverUnits, populationKey, targetValue, targetDate, realizationStart, realizationEnd, recurrence, currency, plannedValue, valuationMethodId, measurementSource, confidence, assumptions, parentBenefitId, benefitGroupId, allocationSetNo, lifecycleStep, recoveryPlan, bauOwnerUserId, controlCadence, statusRag, statusRagNote, realizationState, counting, status, archivedAt, archivedBy, archiveReason, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string, pattern: "^B[0-9]{2,6}$" }
        title: { type: string }
        description: { type: string }
        benefitType: { $ref: "#/components/schemas/BenefitType" }
        valueClass: { $ref: "#/components/schemas/BenefitValueClass" }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        financeValidatorUserId: { $ref: "#/components/schemas/NullableUuid" }
        financeValidationRequired: { type: boolean }
        financialStatementLine: { type: [string, "null"] }
        measurementKpiDefinitionId: { $ref: "#/components/schemas/NullableUuid" }
        measurementKpiVariable: { type: [string, "null"] }
        businessCaseLineId: { $ref: "#/components/schemas/NullableUuid" }
        benefitFormulaId: { $ref: "#/components/schemas/NullableUuid" }
        baselineId: { $ref: "#/components/schemas/NullableUuid" }
        baselineValue: { $ref: "#/components/schemas/NullableDecimal" }
        baselineUnit: { type: [string, "null"] }
        baselineDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        counterfactual: { type: [string, "null"] }
        baselineValidationStatus: { type: string, enum: [unvalidated, validated, rejected] }
        baselineValidatedBy: { $ref: "#/components/schemas/NullableUuid" }
        baselineValidatedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        baselineValidationNote: { type: [string, "null"] }
        driverKey: { type: [string, "null"] }
        driverUnits: { type: [string, "null"] }
        populationKey: { type: [string, "null"] }
        targetValue: { $ref: "#/components/schemas/NullableDecimal" }
        targetDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        realizationStart: { $ref: "#/components/schemas/NullableBusinessDate" }
        realizationEnd: { $ref: "#/components/schemas/NullableBusinessDate" }
        recurrence: { type: [string, "null"], enum: [one_off, recurring, null] }
        currency: { $ref: "#/components/schemas/Currency" }
        plannedValue: { $ref: "#/components/schemas/NullableDecimal" }
        valuationMethodId: { $ref: "#/components/schemas/NullableUuid" }
        measurementSource: { type: [string, "null"] }
        confidence: { type: [string, "null"], enum: [H, M, L, null] }
        assumptions: { type: [string, "null"] }
        parentBenefitId: { $ref: "#/components/schemas/NullableUuid" }
        benefitGroupId: { $ref: "#/components/schemas/NullableUuid" }
        allocationSetNo: { type: integer, minimum: 0 }
        lifecycleStep: { $ref: "#/components/schemas/BenefitLifecycleStep" }
        recoveryPlan: { type: [string, "null"] }
        bauOwnerUserId: { $ref: "#/components/schemas/NullableUuid" }
        controlCadence: { type: [string, "null"], enum: [monthly, quarterly, semiannual, annual, null] }
        statusRag: { type: [string, "null"], enum: [green, amber, red, null], description: "T14 Status; null is shown as Unknown, never green." }
        statusRagNote: { type: [string, "null"] }
        realizationState: { type: string, enum: [not_enabled, enabled_not_yet_measured, measured_pending_validation, validated, sustained], description: "REQ-S08-002: a delivered enabler gives enabled_not_yet_measured, never realized value." }
        counting: { $ref: "#/components/schemas/BenefitCountingStatus" }
        status: { type: string, enum: [active, archived] }
        archivedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        archivedBy: { $ref: "#/components/schemas/NullableUuid" }
        archiveReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
        updatedBy: { $ref: "#/components/schemas/Uuid" }
    BenefitCreate:
      type: object
      description: "A new benefit at Identify. ownerUserId is ONE user id: a body naming two owners fails validation (400; REQ-PB-058). A financial class needs financialStatementLine; non_financial needs measurementKpiDefinitionId (REQ-S08-003)."
      required: [title, description, benefitType, valueClass, ownerUserId, currency]
      additionalProperties: false
      properties:
        title: { type: string, minLength: 1, maxLength: 300 }
        description: { type: string, minLength: 1, maxLength: 8000 }
        benefitType: { $ref: "#/components/schemas/BenefitType" }
        valueClass: { $ref: "#/components/schemas/BenefitValueClass" }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        financeValidatorUserId: { $ref: "#/components/schemas/NullableUuid" }
        financeValidationRequired: { type: boolean, default: true }
        financialStatementLine: { type: [string, "null"], minLength: 1, maxLength: 200 }
        measurementKpiDefinitionId: { $ref: "#/components/schemas/NullableUuid" }
        measurementKpiVariable: { type: [string, "null"], pattern: "^[a-z][a-z0-9_]{0,47}$" }
        businessCaseLineId: { $ref: "#/components/schemas/NullableUuid" }
        benefitFormulaId: { $ref: "#/components/schemas/NullableUuid" }
        baselineId: { $ref: "#/components/schemas/NullableUuid" }
        baselineValue: { $ref: "#/components/schemas/NullableDecimal" }
        baselineUnit: { type: [string, "null"], minLength: 1, maxLength: 50 }
        baselineDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        counterfactual: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        driverKey: { type: [string, "null"], pattern: "^[a-z0-9][a-z0-9_.:-]{0,99}$" }
        driverUnits: { type: [string, "null"], minLength: 1, maxLength: 100 }
        populationKey: { type: [string, "null"], pattern: "^[a-z0-9][a-z0-9_.:-]{0,99}$" }
        targetValue: { $ref: "#/components/schemas/NullableDecimal" }
        targetDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        realizationStart: { $ref: "#/components/schemas/NullableBusinessDate" }
        realizationEnd: { $ref: "#/components/schemas/NullableBusinessDate" }
        recurrence: { type: [string, "null"], enum: [one_off, recurring, null] }
        currency: { $ref: "#/components/schemas/Currency" }
        plannedValue: { $ref: "#/components/schemas/NullableDecimal" }
        valuationMethodId: { $ref: "#/components/schemas/NullableUuid" }
        measurementSource: { type: [string, "null"], minLength: 1, maxLength: 500 }
        confidence: { type: [string, "null"], enum: [H, M, L, null] }
        assumptions: { type: [string, "null"], minLength: 1, maxLength: 8000 }
        parentBenefitId: { $ref: "#/components/schemas/NullableUuid" }
        benefitGroupId: { $ref: "#/components/schemas/NullableUuid" }
    BenefitUpdate:
      type: object
      description: Changes to a benefit's profile and step outputs. The lifecycle step, baseline validation and allocations have their own operations; type, class and currency are fixed once the benefit has values.
      minProperties: 1
      additionalProperties: false
      properties:
        title: { type: string, minLength: 1, maxLength: 300 }
        description: { type: string, minLength: 1, maxLength: 8000 }
        benefitType: { $ref: "#/components/schemas/BenefitType" }
        valueClass: { $ref: "#/components/schemas/BenefitValueClass" }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        financeValidatorUserId: { $ref: "#/components/schemas/NullableUuid" }
        financeValidationRequired: { type: boolean }
        financialStatementLine: { type: [string, "null"], minLength: 1, maxLength: 200 }
        measurementKpiDefinitionId: { $ref: "#/components/schemas/NullableUuid" }
        measurementKpiVariable: { type: [string, "null"], pattern: "^[a-z][a-z0-9_]{0,47}$" }
        businessCaseLineId: { $ref: "#/components/schemas/NullableUuid" }
        benefitFormulaId: { $ref: "#/components/schemas/NullableUuid" }
        baselineId: { $ref: "#/components/schemas/NullableUuid" }
        baselineValue: { $ref: "#/components/schemas/NullableDecimal" }
        baselineUnit: { type: [string, "null"], minLength: 1, maxLength: 50 }
        baselineDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        counterfactual: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        driverKey: { type: [string, "null"], pattern: "^[a-z0-9][a-z0-9_.:-]{0,99}$" }
        driverUnits: { type: [string, "null"], minLength: 1, maxLength: 100 }
        populationKey: { type: [string, "null"], pattern: "^[a-z0-9][a-z0-9_.:-]{0,99}$" }
        targetValue: { $ref: "#/components/schemas/NullableDecimal" }
        targetDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        realizationStart: { $ref: "#/components/schemas/NullableBusinessDate" }
        realizationEnd: { $ref: "#/components/schemas/NullableBusinessDate" }
        recurrence: { type: [string, "null"], enum: [one_off, recurring, null] }
        currency: { $ref: "#/components/schemas/Currency" }
        plannedValue: { $ref: "#/components/schemas/NullableDecimal" }
        valuationMethodId: { $ref: "#/components/schemas/NullableUuid" }
        measurementSource: { type: [string, "null"], minLength: 1, maxLength: 500 }
        confidence: { type: [string, "null"], enum: [H, M, L, null] }
        assumptions: { type: [string, "null"], minLength: 1, maxLength: 8000 }
        parentBenefitId: { $ref: "#/components/schemas/NullableUuid" }
        benefitGroupId: { $ref: "#/components/schemas/NullableUuid" }
        recoveryPlan: { type: [string, "null"], minLength: 1, maxLength: 8000 }
        bauOwnerUserId: { $ref: "#/components/schemas/NullableUuid" }
        controlCadence: { type: [string, "null"], enum: [monthly, quarterly, semiannual, annual, null] }
        statusRag: { type: [string, "null"], enum: [green, amber, red, null] }
        statusRagNote: { type: [string, "null"], minLength: 1, maxLength: 2000 }
    BenefitRealized:
      type: object
      required: [validated, validatedCount, sustained, sustainedCount, pending, pendingCount, kpiActual]
      additionalProperties: false
      description: T14 Realized, with its states kept apart. kpiActual is the latest accepted actual of a non-financial benefit's agreed KPI (Unknown when none).
      properties:
        validated: { $ref: "#/components/schemas/BenefitAmount" }
        validatedCount: { type: integer, minimum: 0 }
        sustained: { $ref: "#/components/schemas/BenefitAmount" }
        sustainedCount: { type: integer, minimum: 0 }
        pending: { $ref: "#/components/schemas/BenefitAmount" }
        pendingCount: { type: integer, minimum: 0 }
        kpiActual:
          type: object
          required: [status, value, reason]
          additionalProperties: false
          properties:
            status: { type: string, enum: [known, unknown, stale, not_applicable] }
            value: { $ref: "#/components/schemas/NullableDecimal" }
            reason: { type: [string, "null"] }
    BenefitRegisterRow:
      type: object
      description: One T14 Benefits Register row (B0123, ten columns) plus the lifecycle step, realization state and counting status.
      required: [id, code, title, benefitType, valueClass, baseline, target, valueSar, realized, ownerUserId, evidenceCount, latestEvidenceIds, status, lifecycleStep, realizationState, counting, currency, version]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        code: { type: string }
        title: { type: string }
        benefitType: { $ref: "#/components/schemas/BenefitType" }
        valueClass: { $ref: "#/components/schemas/BenefitValueClass" }
        baseline:
          type: object
          required: [value, unit, date, baselineId, validationStatus]
          additionalProperties: false
          properties:
            value: { $ref: "#/components/schemas/NullableDecimal" }
            unit: { type: [string, "null"] }
            date: { $ref: "#/components/schemas/NullableBusinessDate" }
            baselineId: { $ref: "#/components/schemas/NullableUuid" }
            validationStatus: { type: string, enum: [unvalidated, validated, rejected] }
        target:
          type: object
          required: [value, date]
          additionalProperties: false
          properties:
            value: { $ref: "#/components/schemas/NullableDecimal" }
            date: { $ref: "#/components/schemas/NullableBusinessDate" }
        valueSar: { $ref: "#/components/schemas/BenefitAmount" }
        realized: { $ref: "#/components/schemas/BenefitRealized" }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        evidenceCount: { type: integer, minimum: 0 }
        latestEvidenceIds: { type: array, items: { $ref: "#/components/schemas/Uuid" }, maxItems: 5 }
        status: { type: string, enum: [green, amber, red, unknown], description: "T14 Status R/A/G; unknown when not set, never green." }
        lifecycleStep: { $ref: "#/components/schemas/BenefitLifecycleStep" }
        realizationState: { type: string, enum: [not_enabled, enabled_not_yet_measured, measured_pending_validation, validated, sustained] }
        counting: { $ref: "#/components/schemas/BenefitCountingStatus" }
        currency: { $ref: "#/components/schemas/Currency" }
        version: { $ref: "#/components/schemas/Version" }
    BenefitLifecycle:
      type: object
      required: [benefitId, currentStep, steps, history]
      additionalProperties: false
      properties:
        benefitId: { $ref: "#/components/schemas/Uuid" }
        currentStep: { $ref: "#/components/schemas/BenefitLifecycleStep" }
        steps:
          type: array
          minItems: 6
          maxItems: 6
          items:
            type: object
            required: [code, ordinal, stepEn, questionEn, outputEn, stepAr, questionAr, outputAr, arIsProvisional, preconditionsMet, missing]
            additionalProperties: false
            properties:
              code: { $ref: "#/components/schemas/BenefitLifecycleStep" }
              ordinal: { type: integer, minimum: 1, maximum: 6 }
              stepEn: { type: string }
              questionEn: { type: string, description: "B0121 verbatim." }
              outputEn: { type: string, description: "B0121 verbatim." }
              stepAr: { type: string }
              questionAr: { type: string }
              outputAr: { type: string }
              arIsProvisional: { type: boolean }
              preconditionsMet: { type: boolean }
              missing: { type: array, items: { type: string, enum: [baseline, formula, target, owner, enablers, recovery_plan, bau_owner, control_cadence] } }
        history:
          type: array
          items:
            type: object
            required: [fromStep, toStep, benefitVersion, occurredAt, actorUserId]
            additionalProperties: false
            properties:
              fromStep: { oneOf: [{ $ref: "#/components/schemas/BenefitLifecycleStep" }, { type: "null" }] }
              toStep: { $ref: "#/components/schemas/BenefitLifecycleStep" }
              benefitVersion: { type: integer, minimum: 1 }
              occurredAt: { $ref: "#/components/schemas/Timestamp" }
              actorUserId: { $ref: "#/components/schemas/Uuid" }
    BenefitLifecycleAdvance:
      type: object
      required: [toStep]
      additionalProperties: false
      properties:
        toStep: { $ref: "#/components/schemas/BenefitLifecycleStep" }
        note: { type: string, minLength: 1, maxLength: 2000 }
    BenefitBaselineDecision:
      type: object
      required: [decision]
      additionalProperties: false
      properties:
        decision: { type: string, enum: [validated, rejected] }
        note: { type: string, minLength: 1, maxLength: 2000, description: "Required to reject." }
    BenefitEnabler:
      type: object
      required: [id, benefitId, initiativeId, deliverableId, capabilityId, note, delivered, status, removedAt, removedBy, removeReason, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        benefitId: { $ref: "#/components/schemas/Uuid" }
        initiativeId: { $ref: "#/components/schemas/Uuid" }
        deliverableId: { $ref: "#/components/schemas/NullableUuid" }
        capabilityId: { $ref: "#/components/schemas/NullableUuid" }
        note: { type: [string, "null"] }
        delivered: { type: boolean, description: "The deliverable is accepted, or (without a deliverable) the initiative is completed. Never realized value (REQ-S08-002)." }
        status: { type: string, enum: [active, removed] }
        removedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        removedBy: { $ref: "#/components/schemas/NullableUuid" }
        removeReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    BenefitEnablerCreate:
      type: object
      required: [initiativeId]
      additionalProperties: false
      properties:
        initiativeId: { $ref: "#/components/schemas/Uuid" }
        deliverableId: { $ref: "#/components/schemas/NullableUuid" }
        capabilityId: { $ref: "#/components/schemas/NullableUuid" }
        note: { type: string, minLength: 1, maxLength: 2000 }
    BenefitValueLine:
      type: object
      required: [periodStart, periodEnd, amount, kpiValue, recordType, recordId, basis]
      additionalProperties: false
      properties:
        periodStart: { $ref: "#/components/schemas/NullableBusinessDate" }
        periodEnd: { $ref: "#/components/schemas/NullableBusinessDate" }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
        recordType: { type: string, enum: [benefit_plan_value, benefit_measurement] }
        recordId: { $ref: "#/components/schemas/Uuid" }
        basis: { type: [string, "null"], enum: [validated, provisional, null], description: "For submitted values: provisional while the comparison basis is not Finance-validated (REQ-S08-008)." }
    BenefitValues:
      type: object
      required: [benefitId, currency, series]
      additionalProperties: false
      properties:
        benefitId: { $ref: "#/components/schemas/Uuid" }
        currency: { $ref: "#/components/schemas/Currency" }
        series:
          type: array
          minItems: 7
          maxItems: 7
          items:
            type: object
            required: [state, total, count, lines]
            additionalProperties: false
            properties:
              state: { $ref: "#/components/schemas/BenefitValueState" }
              total: { $ref: "#/components/schemas/BenefitAmount" }
              count: { type: integer, minimum: 0 }
              lines: { type: array, items: { $ref: "#/components/schemas/BenefitValueLine" } }
    BenefitPlanValue:
      type: object
      required: [id, benefitId, valueKind, periodStart, periodEnd, amount, kpiValue, currency, note, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        benefitId: { $ref: "#/components/schemas/Uuid" }
        valueKind: { type: string, enum: [planned, forecast] }
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
        currency: { $ref: "#/components/schemas/Currency" }
        note: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    BenefitPlanValueCreate:
      type: object
      required: [valueKind, periodStart, periodEnd]
      additionalProperties: false
      description: At least one of amount and kpiValue. Currency is the benefit's.
      properties:
        valueKind: { type: string, enum: [planned, forecast] }
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
        note: { type: string, minLength: 1, maxLength: 2000 }
    BenefitPlanValueUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
        note: { type: [string, "null"], minLength: 1, maxLength: 2000 }
    BenefitAllocationShare:
      type: object
      required: [initiativeId, share]
      additionalProperties: false
      properties:
        initiativeId: { $ref: "#/components/schemas/Uuid" }
        share: { $ref: "#/components/schemas/Decimal", description: "A fraction: 0.6 = 60 %. Above 0 and at most 1." }
        basis: { type: [string, "null"], minLength: 1, maxLength: 1000 }
    BenefitAllocations:
      type: object
      required: [benefitId, setNo, allocations, allocatedShare, unallocatedShare]
      additionalProperties: false
      properties:
        benefitId: { $ref: "#/components/schemas/Uuid" }
        setNo: { type: integer, minimum: 0 }
        allocations: { type: array, items: { $ref: "#/components/schemas/BenefitAllocationShare" } }
        allocatedShare: { $ref: "#/components/schemas/Decimal" }
        unallocatedShare: { $ref: "#/components/schemas/Decimal", description: "1 - allocatedShare (REQ-S08-013), e.g. 0.100000 for 60 % + 30 %." }
    BenefitAllocationsReplace:
      type: object
      required: [allocations]
      additionalProperties: false
      properties:
        allocations: { type: array, maxItems: 100, items: { $ref: "#/components/schemas/BenefitAllocationShare" } }
    BenefitGroup:
      type: object
      required: [id, transformationId, code, title, description, countedBenefitId, memberBenefitIds, status, archivedAt, archivedBy, archiveReason, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      description: A shared-benefit group (REQ-PB-058). Only countedBenefitId is counted; while it is null no member is counted.
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string, pattern: "^BG-[0-9]{2,6}$" }
        title: { type: string }
        description: { type: [string, "null"] }
        countedBenefitId: { $ref: "#/components/schemas/NullableUuid" }
        memberBenefitIds: { type: array, items: { $ref: "#/components/schemas/Uuid" } }
        status: { type: string, enum: [active, archived] }
        archivedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        archivedBy: { $ref: "#/components/schemas/NullableUuid" }
        archiveReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    BenefitGroupCreate:
      type: object
      required: [title]
      additionalProperties: false
      properties:
        title: { type: string, minLength: 1, maxLength: 300 }
        description: { type: string, minLength: 1, maxLength: 4000 }
    BenefitGroupUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        title: { type: string, minLength: 1, maxLength: 300 }
        description: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        countedBenefitId: { $ref: "#/components/schemas/NullableUuid" }
    BenefitOverlapDimension:
      type: string
      enum: [driver, population, period]
    BenefitOverlap:
      type: object
      required: [id, transformationId, benefitAId, benefitBId, dimensions, driverKey, populationKey, overlapStart, overlapEnd, detectedBy, status, resolution, excludedBenefitId, resolutionNote, resolvedBy, resolvedAt, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        benefitAId: { $ref: "#/components/schemas/Uuid" }
        benefitBId: { $ref: "#/components/schemas/Uuid" }
        dimensions: { type: array, minItems: 1, items: { $ref: "#/components/schemas/BenefitOverlapDimension" } }
        driverKey: { type: [string, "null"] }
        populationKey: { type: [string, "null"] }
        overlapStart: { $ref: "#/components/schemas/NullableBusinessDate" }
        overlapEnd: { $ref: "#/components/schemas/NullableBusinessDate" }
        detectedBy: { type: string, enum: [rule, user] }
        status: { type: string, enum: [open, resolved] }
        resolution: { type: [string, "null"], enum: [no_economic_overlap, duplicate, null] }
        excludedBenefitId: { $ref: "#/components/schemas/NullableUuid" }
        resolutionNote: { type: [string, "null"] }
        resolvedBy: { $ref: "#/components/schemas/NullableUuid" }
        resolvedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    BenefitOverlapCreate:
      type: object
      required: [benefitAId, benefitBId, dimensions]
      additionalProperties: false
      properties:
        benefitAId: { $ref: "#/components/schemas/Uuid" }
        benefitBId: { $ref: "#/components/schemas/Uuid" }
        dimensions: { type: array, minItems: 1, maxItems: 3, uniqueItems: true, items: { $ref: "#/components/schemas/BenefitOverlapDimension" } }
    BenefitOverlapResolve:
      type: object
      required: [resolution, note]
      additionalProperties: false
      properties:
        resolution: { type: string, enum: [no_economic_overlap, duplicate] }
        excludedBenefitId: { $ref: "#/components/schemas/Uuid", description: "Required for duplicate: the benefit that is never counted." }
        note: { type: string, minLength: 3, maxLength: 4000 }
    BenefitScenarioValue:
      type: object
      required: [id, scenarioId, scenarioKind, benefitId, periodStart, periodEnd, amount, kpiValue, currency, note, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      description: A scenario value, always labelled with its scenario kind; never an actual (REQ-S08-018).
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        scenarioId: { $ref: "#/components/schemas/Uuid" }
        scenarioKind: { type: string, enum: [base, upside, downside] }
        benefitId: { $ref: "#/components/schemas/Uuid" }
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
        currency: { $ref: "#/components/schemas/Currency" }
        note: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    BenefitScenario:
      type: object
      required: [id, transformationId, businessCaseId, kind, title, assumptions, values, status, archivedAt, archivedBy, archiveReason, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        businessCaseId: { $ref: "#/components/schemas/NullableUuid" }
        kind: { type: string, enum: [base, upside, downside] }
        title: { type: string }
        assumptions: { type: [string, "null"] }
        values: { type: array, items: { $ref: "#/components/schemas/BenefitScenarioValue" } }
        status: { type: string, enum: [active, archived] }
        archivedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        archivedBy: { $ref: "#/components/schemas/NullableUuid" }
        archiveReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    BenefitScenarioCreate:
      type: object
      required: [kind, title]
      additionalProperties: false
      properties:
        kind: { type: string, enum: [base, upside, downside] }
        title: { type: string, minLength: 1, maxLength: 300 }
        assumptions: { type: string, minLength: 1, maxLength: 8000 }
        businessCaseId: { $ref: "#/components/schemas/NullableUuid" }
    BenefitScenarioUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        title: { type: string, minLength: 1, maxLength: 300 }
        assumptions: { type: [string, "null"], minLength: 1, maxLength: 8000 }
        archiveReason: { type: string, minLength: 3, maxLength: 1000, description: "Archives the scenario." }
    BenefitScenarioValueCreate:
      type: object
      required: [benefitId, periodStart, periodEnd]
      additionalProperties: false
      properties:
        benefitId: { $ref: "#/components/schemas/Uuid" }
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
        note: { type: string, minLength: 1, maxLength: 2000 }
    BenefitScenarioValueUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
        note: { type: [string, "null"], minLength: 1, maxLength: 2000 }
    BenefitValuationMethod:
      type: object
      required: [id, transformationId, code, name, method, appliesToType, kpiDefinitionId, unitValue, currency, status, decidedBy, decidedAt, decisionNote, retiredAt, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string, pattern: "^VM-[0-9]{2,6}$" }
        name: { type: string }
        method: { type: string }
        appliesToType: { type: string, enum: [cx, risk, strategic, other] }
        kpiDefinitionId: { $ref: "#/components/schemas/NullableUuid" }
        unitValue: { $ref: "#/components/schemas/NullableDecimal" }
        currency: { $ref: "#/components/schemas/Currency" }
        status: { type: string, enum: [proposed, approved, rejected, retired] }
        decidedBy: { $ref: "#/components/schemas/NullableUuid" }
        decidedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        decisionNote: { type: [string, "null"] }
        retiredAt: { $ref: "#/components/schemas/NullableTimestamp" }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    BenefitValuationMethodCreate:
      type: object
      required: [name, method, appliesToType, currency]
      additionalProperties: false
      properties:
        name: { type: string, minLength: 1, maxLength: 300 }
        method: { type: string, minLength: 1, maxLength: 8000 }
        appliesToType: { type: string, enum: [cx, risk, strategic, other] }
        kpiDefinitionId: { $ref: "#/components/schemas/NullableUuid" }
        unitValue: { $ref: "#/components/schemas/NullableDecimal" }
        currency: { $ref: "#/components/schemas/Currency" }
    BenefitValuationMethodDecision:
      type: object
      required: [decision]
      additionalProperties: false
      properties:
        decision: { type: string, enum: [approved, rejected, retired] }
        note: { type: string, minLength: 1, maxLength: 2000, description: "Required to reject." }
    BenefitMeasurementInput:
      type: object
      required: [variableName, kpiActualId, kpiValueNo, value, periodStart, periodEnd]
      additionalProperties: false
      properties:
        variableName: { type: string }
        kpiActualId: { $ref: "#/components/schemas/NullableUuid" }
        kpiValueNo: { type: [integer, "null"], minimum: 1 }
        value: { $ref: "#/components/schemas/Decimal" }
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
    BenefitMeasurement:
      type: object
      description: BenefitMeasurement (REQ-S16-017) with its lineage (REQ-S08-006). A validated row is never edited; corrections are linked amendment or reversal rows.
      required: [id, benefitId, measurementNo, kind, correctsMeasurementId, source, calculationRunId, benefitCalculationId, formulaVersionId, periodStart, periodEnd, amount, kpiValue, currency, missingReason, attribution, assumptions, status, sustainPhase, validatedAmount, basis, inputs, evidenceIds, financeValidationId, submittedBy, submittedAt, decidedBy, decidedAt, reason, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        benefitId: { $ref: "#/components/schemas/Uuid" }
        measurementNo: { type: integer, minimum: 1 }
        kind: { type: string, enum: [measurement, amendment, reversal] }
        correctsMeasurementId: { $ref: "#/components/schemas/NullableUuid" }
        source: { type: string, enum: [manual, kpi_recalculation, correction] }
        calculationRunId: { $ref: "#/components/schemas/NullableUuid" }
        benefitCalculationId: { $ref: "#/components/schemas/NullableUuid" }
        formulaVersionId: { $ref: "#/components/schemas/NullableUuid" }
        periodStart: { $ref: "#/components/schemas/NullableBusinessDate" }
        periodEnd: { $ref: "#/components/schemas/NullableBusinessDate" }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
        currency: { $ref: "#/components/schemas/Currency" }
        missingReason: { type: [string, "null"] }
        attribution: { type: [string, "null"] }
        assumptions: { type: [string, "null"] }
        status: { type: string, enum: [draft, submitted, validated, rejected, superseded] }
        sustainPhase: { type: boolean }
        validatedAmount: { $ref: "#/components/schemas/NullableDecimal" }
        basis: { type: string, enum: [validated, provisional], description: "provisional while the benefit's baseline (or the formula version used) is not Finance-validated (REQ-S08-008)." }
        inputs: { type: array, items: { $ref: "#/components/schemas/BenefitMeasurementInput" } }
        evidenceIds: { type: array, items: { $ref: "#/components/schemas/Uuid" } }
        financeValidationId: { $ref: "#/components/schemas/NullableUuid" }
        submittedBy: { $ref: "#/components/schemas/NullableUuid" }
        submittedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        decidedBy: { $ref: "#/components/schemas/NullableUuid" }
        decidedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        reason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    BenefitMeasurementCreate:
      type: object
      additionalProperties: false
      description: "One of amount, kpiValue or missingReason. With formulaVersionId the amount is computed by the restricted formula engine from variables (ADR-0024 §6) and the lineage is stored. submit: true submits at once (needs the period and, for a manual value, evidence)."
      properties:
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
        missingReason: { type: string, minLength: 3, maxLength: 1000 }
        attribution: { type: string, minLength: 1, maxLength: 4000 }
        assumptions: { type: string, minLength: 1, maxLength: 8000 }
        formulaVersionId: { $ref: "#/components/schemas/Uuid" }
        variables: { type: object, maxProperties: 30, additionalProperties: { $ref: "#/components/schemas/Decimal" }, propertyNames: { pattern: "^[a-z][a-z0-9_]{0,47}$" } }
        evidenceIds: { type: array, maxItems: 50, uniqueItems: true, items: { $ref: "#/components/schemas/Uuid" } }
        submit: { type: boolean, default: false }
    BenefitMeasurementUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        periodStart: { $ref: "#/components/schemas/NullableBusinessDate" }
        periodEnd: { $ref: "#/components/schemas/NullableBusinessDate" }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
        missingReason: { type: [string, "null"], minLength: 3, maxLength: 1000 }
        attribution: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        assumptions: { type: [string, "null"], minLength: 1, maxLength: 8000 }
        evidenceIds: { type: array, maxItems: 50, uniqueItems: true, items: { $ref: "#/components/schemas/Uuid" }, description: "Evidence links to add (links are append-only)." }
    FinanceValidationItemDecision:
      type: object
      required: [decision]
      additionalProperties: false
      properties:
        decision: { type: string, enum: [accepted, rejected] }
        note: { type: string, minLength: 1, maxLength: 2000 }
    FinanceValidationContent:
      type: object
      required: [baseline, attribution, calculation, evidence, measurementPeriod, assumptions]
      additionalProperties: false
      description: The immutable snapshot presented to the validator (REQ-S08-015).
      properties:
        baseline:
          type: object
          required: [value, unit, date, baselineId, counterfactual, validationStatus]
          additionalProperties: false
          properties:
            value: { $ref: "#/components/schemas/NullableDecimal" }
            unit: { type: [string, "null"] }
            date: { $ref: "#/components/schemas/NullableBusinessDate" }
            baselineId: { $ref: "#/components/schemas/NullableUuid" }
            counterfactual: { type: [string, "null"] }
            validationStatus: { type: string, enum: [unvalidated, validated, rejected] }
        attribution: { type: [string, "null"] }
        calculation:
          type: object
          required: [formulaVersionId, benefitCalculationId, amount, kpiValue, currency, inputs]
          additionalProperties: false
          properties:
            formulaVersionId: { $ref: "#/components/schemas/NullableUuid" }
            benefitCalculationId: { $ref: "#/components/schemas/NullableUuid" }
            amount: { $ref: "#/components/schemas/NullableDecimal" }
            kpiValue: { $ref: "#/components/schemas/NullableDecimal" }
            currency: { $ref: "#/components/schemas/Currency" }
            inputs: { type: array, items: { $ref: "#/components/schemas/BenefitMeasurementInput" } }
        evidence: { type: array, items: { $ref: "#/components/schemas/Uuid" } }
        measurementPeriod:
          type: object
          required: [start, end]
          additionalProperties: false
          properties:
            start: { $ref: "#/components/schemas/BusinessDate" }
            end: { $ref: "#/components/schemas/BusinessDate" }
        assumptions: { type: [string, "null"] }
    FinanceValidation:
      type: object
      description: FinanceValidation (REQ-S16-017) - a Finance queue item and its decision, or a Finance amendment or reversal linked to the original.
      required: [id, benefitId, benefitMeasurementId, kind, correctsValidationId, assigneeUserId, status, content, items, approvedAmount, decisionNote, decidedBy, decidedAt, reason, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        benefitId: { $ref: "#/components/schemas/Uuid" }
        benefitMeasurementId: { $ref: "#/components/schemas/Uuid" }
        kind: { type: string, enum: [validation, amendment, reversal] }
        correctsValidationId: { $ref: "#/components/schemas/NullableUuid" }
        assigneeUserId: { $ref: "#/components/schemas/NullableUuid", description: "null = the transformation's FIN party." }
        status: { type: string, enum: [queued, approved, rejected, withdrawn] }
        content: { $ref: "#/components/schemas/FinanceValidationContent" }
        items:
          type: object
          required: [baseline, attribution, calculation, evidence, measurementPeriod, assumptions]
          additionalProperties: false
          description: The six item decisions; null while queued.
          properties:
            baseline: { oneOf: [{ $ref: "#/components/schemas/FinanceValidationItemDecision" }, { type: "null" }] }
            attribution: { oneOf: [{ $ref: "#/components/schemas/FinanceValidationItemDecision" }, { type: "null" }] }
            calculation: { oneOf: [{ $ref: "#/components/schemas/FinanceValidationItemDecision" }, { type: "null" }] }
            evidence: { oneOf: [{ $ref: "#/components/schemas/FinanceValidationItemDecision" }, { type: "null" }] }
            measurementPeriod: { oneOf: [{ $ref: "#/components/schemas/FinanceValidationItemDecision" }, { type: "null" }] }
            assumptions: { oneOf: [{ $ref: "#/components/schemas/FinanceValidationItemDecision" }, { type: "null" }] }
        approvedAmount: { $ref: "#/components/schemas/NullableDecimal" }
        decisionNote: { type: [string, "null"] }
        decidedBy: { $ref: "#/components/schemas/NullableUuid" }
        decidedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        reason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    FinanceValidationDecision:
      type: object
      required: [decision, items]
      additionalProperties: false
      description: "A decision on each of the six items is required; a missing item (e.g. measurementPeriod) is refused with 422 finance_validation.content_incomplete (REQ-S08-015)."
      properties:
        decision: { type: string, enum: [approved, rejected] }
        items:
          type: object
          additionalProperties: false
          properties:
            baseline: { $ref: "#/components/schemas/FinanceValidationItemDecision" }
            attribution: { $ref: "#/components/schemas/FinanceValidationItemDecision" }
            calculation: { $ref: "#/components/schemas/FinanceValidationItemDecision" }
            evidence: { $ref: "#/components/schemas/FinanceValidationItemDecision" }
            measurementPeriod: { $ref: "#/components/schemas/FinanceValidationItemDecision" }
            assumptions: { $ref: "#/components/schemas/FinanceValidationItemDecision" }
        approvedAmount: { $ref: "#/components/schemas/NullableDecimal" }
        note: { type: string, minLength: 1, maxLength: 2000, description: "Required to reject." }
    FinanceValidationAmendment:
      type: object
      required: [correctedAmount, reason]
      additionalProperties: false
      properties:
        correctedAmount: { $ref: "#/components/schemas/Decimal" }
        reason: { $ref: "#/components/schemas/Reason" }
    BenefitTotalLine:
      type: object
      required: [valueClass, state, total, count]
      additionalProperties: false
      properties:
        valueClass: { type: string, enum: [revenue_uplift, margin_uplift, cash_saving, avoided_cost, working_capital_release, non_financial_valued] }
        state: { $ref: "#/components/schemas/BenefitValueState" }
        total: { $ref: "#/components/schemas/BenefitAmount" }
        count: { type: integer, minimum: 0 }
    BenefitTotalsCurrency:
      type: object
      required: [currency, lines, pendingOverlap, gross, implementationCost, net]
      additionalProperties: false
      properties:
        currency: { $ref: "#/components/schemas/Currency" }
        lines: { type: array, items: { $ref: "#/components/schemas/BenefitTotalLine" } }
        pendingOverlap: { type: array, items: { $ref: "#/components/schemas/BenefitTotalLine" }, description: "Validated and sustained values of benefits with an open overlap warning; never in the validated lines (REQ-S08-014)." }
        gross:
          type: object
          required: [planned, validated]
          additionalProperties: false
          properties:
            planned: { $ref: "#/components/schemas/BenefitAmount" }
            validated: { $ref: "#/components/schemas/BenefitAmount" }
        implementationCost:
          type: object
          required: [cash, nonCash, total]
          additionalProperties: false
          description: Each business-case investment line once (REQ-S08-011).
          properties:
            cash: { $ref: "#/components/schemas/BenefitAmount" }
            nonCash: { $ref: "#/components/schemas/BenefitAmount" }
            total: { $ref: "#/components/schemas/BenefitAmount" }
        net:
          type: object
          required: [planned, validated]
          additionalProperties: false
          properties:
            planned: { $ref: "#/components/schemas/BenefitAmount" }
            validated: { $ref: "#/components/schemas/BenefitAmount" }
    BenefitTotals:
      type: object
      required: [scope, scopeId, allocated, transformationIds, currencies, nonFinancialCount, excluded, computedAt]
      additionalProperties: false
      description: Totals counted once (ADR-0030 §7). Currencies are never converted. A state with no values is a known 0 with count 0; a missing input is unknown, never 0.
      properties:
        scope: { type: string, enum: [transformation, initiative, organization] }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        allocated: { type: boolean, description: "true for an initiative view: amounts are share x value, labelled allocated, and never added to a transformation total." }
        transformationIds: { type: array, items: { $ref: "#/components/schemas/Uuid" } }
        currencies: { type: array, items: { $ref: "#/components/schemas/BenefitTotalsCurrency" } }
        nonFinancialCount: { type: integer, minimum: 0, description: "Non-financial benefits without a valuation method: Value n/a, not part of any SAR line." }
        excluded:
          type: array
          items:
            type: object
            required: [benefitId, code, reason]
            additionalProperties: false
            properties:
              benefitId: { $ref: "#/components/schemas/Uuid" }
              code: { type: string }
              reason: { type: string, enum: [archived, parent_rollup, group_counted_member_not_named, group_member_not_counted, overlap_duplicate] }
        computedAt: { $ref: "#/components/schemas/Timestamp" }
''' + "".join(page(n, i) for n, i in [
    ("BenefitRegisterPage", "BenefitRegisterRow"), ("BenefitEnablerPage", "BenefitEnabler"), ("BenefitGroupPage", "BenefitGroup"),
    ("BenefitOverlapPage", "BenefitOverlap"), ("BenefitScenarioPage", "BenefitScenario"),
    ("BenefitValuationMethodPage", "BenefitValuationMethod"), ("BenefitMeasurementPage", "BenefitMeasurement"),
    ("FinanceValidationPage", "FinanceValidation")])

TAGS = '''  - name: benefits
    description: T14 Benefits Register, the six-step benefits lifecycle, enablers, value series, planned and forecast values (P4, ADR-0029, ADR-0030).
  - name: benefit-allocations
    description: Contribution allocations of a canonical benefit; above 100 % refused, the rest unallocated (P4, ADR-0029).
  - name: benefit-groups
    description: Shared-benefit groups with one counted member (P4, ADR-0029).
  - name: benefit-overlaps
    description: Overlap warnings and their Finance resolution (P4, ADR-0029).
  - name: benefit-scenarios
    description: Base, upside and downside scenarios, never mixed into actuals (P4, ADR-0029).
  - name: benefit-valuation-methods
    description: Finance-approved valuation methods for non-financial benefits (P4, ADR-0029).
  - name: benefit-measurements
    description: Benefit measurements with lineage and evidence, submitted for Finance validation (P4, ADR-0030).
  - name: finance-validations
    description: The Finance validation queue, decisions on six items, amendments and reversals (P4, ADR-0030).
  - name: benefit-totals
    description: Benefit totals counted once, by value class and state; gross, implementation cost and net (P4, ADR-0030).
'''

INFO_ADD = '''
    **P4 additions, slice B (T-DG4-ARCH-03, ADR-0029, ADR-0030).** Additive within v1: new paths, schemas, tags and one
    response. Benefit money is a decimal string; Value (SAR) of a non-financial benefit is n/a, and a missing value is
    Unknown, never 0. Submitted values stay pending until a Finance user validates them on six items; a validated value
    is never edited in place (409) and is corrected by linked amendments or reversals. Totals count each benefit once and
    never add value states, scenarios or allocations together. Finance validation is a decision by a named Finance user.
'''

RESPONSE = '''    BenefitValueConflict:
      description: A validated benefit value is never edited in place (`urn:mth:problem:invalid-transition`, code `benefit_measurement.validated_immutable`; REQ-S08-017), or If-Match is stale (`urn:mth:problem:version-conflict`). Nothing was written.
      content:
        application/problem+json:
          schema: { $ref: "#/components/schemas/Problem" }
'''

PERMS = ["benefit.edit", "benefit.advance", "benefit.allocate", "benefit.measure", "benefit_scenario.edit", "benefit_group.manage"]


def main(path):
    s = open(path, encoding="utf-8").read()
    assert "operationId: listBenefits" not in s, "already applied"
    assert "  version: 1.3.0-p4\n" in s
    for key in PARAMS:
        assert f"\n    {key}:\n" not in s, key
    anchor = "    trajectory and the threshold version in force, never from task completion. Trajectory approval is a business approval.\n"
    assert s.count(anchor) == 1
    s = s.replace(anchor, anchor + INFO_ADD, 1)
    tag_anchor = "security:\n  - sessionCookie: []\npaths:\n"
    assert tag_anchor in s
    s = s.replace(tag_anchor, TAGS + tag_anchor, 1)
    comp = "\ncomponents:\n"
    assert s.count(comp) == 1
    s = s.replace(comp, "\n" + render_paths() + "components:\n", 1)
    p_anchor = "\n  parameters:\n"
    assert s.count(p_anchor) == 1
    s = s.replace(p_anchor, p_anchor + render_params(), 1)
    r_anchor = "    PreconditionRequired:\n"
    assert s.count(r_anchor) == 1
    s = s.replace(r_anchor, RESPONSE + r_anchor, 1)
    perm_anchor = "        - data_quality.manage\n    RoleCode:\n"
    assert s.count(perm_anchor) == 1
    s = s.replace(perm_anchor, "        - data_quality.manage\n" + "".join(f"        - {p}\n" for p in PERMS) + "    RoleCode:\n", 1)
    s = s.rstrip("\n") + "\n" + SCHEMAS
    open(path, "w", encoding="utf-8").write(s)
    print(f"added {len(OPS)} operations: " + ", ".join(o["id"] for o in OPS))


if __name__ == "__main__":
    main(sys.argv[1])
