#!/usr/bin/env python3
"""T-DG4-ARCH-06: generates the slice F and G OpenAPI additions (ADR-0033, ADR-0034) and inserts them into
docs/api/openapi.yaml. Provenance only: run once by the solution-architect; the YAML file is the contract.
The op()/render_paths()/render_params()/page() helpers are copied from the T-DG4-ARCH-05 generator.

  python3 docs/delivery/handbacks/DG4/T-DG4-ARCH-06-evidence/openapi-p4-arch06.py docs/api/openapi.yaml

Every operation declares the ADR-0007 §5b statuses: 400, 401, 403 (when it needs a permission or a record-level
right, and on every unsafe method), 404 (path ids), 409/428 (If-Match), 422 (business rules) and 429; problem+json
errors; ETag on single-resource responses; Cursor/Limit on paginated lists. Request bodies are application/json.
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


U = '{ $ref: "#/components/schemas/Uuid" }'
NU = '{ $ref: "#/components/schemas/NullableUuid" }'
TS = '{ $ref: "#/components/schemas/Timestamp" }'
NTS = '{ oneOf: [{ $ref: "#/components/schemas/Timestamp" }, { type: "null" }] }'
BD = '{ $ref: "#/components/schemas/BusinessDate" }'
NBD = '{ $ref: "#/components/schemas/NullableBusinessDate" }'
V = '{ $ref: "#/components/schemas/Version" }'
PARTY = '{ $ref: "#/components/schemas/PartyCode" }'
OUTKIND = '{ $ref: "#/components/schemas/MeetingOutputKind" }'

UUID = '{ $ref: "#/components/schemas/Uuid" }'
DATE = '{ $ref: "#/components/schemas/BusinessDate" }'
T = "/api/v1/transformations/{transformationId}"
TP = ["TransformationId"]
RD = dict(forbidden=False, rule=False)
def sub(base, name, pid, extra=()):
    return T + f"/{base}/{{{pid[0].lower()+pid[1:]}}}", TP + [pid] + list(extra)

# ======================================================================================= slice F (ADR-0033)
op("/api/v1/adoption-indicator-templates", "get", "listAdoptionIndicatorTemplates", "adoption-indicators",
   "The seven leading adoption indicators of B0109-B0115, verbatim, as KPI templates; indicator 4 has two measures (training completion, observed proficiency). Arabic labels carry arProvisional (REQ-PB-071; any signed-in user).",
   ok_schema="AdoptionIndicatorTemplateList", not_found=False, **RD)
op(T + "/stakeholder-groups", "get", "listStakeholderGroups", "stakeholder-groups",
   "The transformation's stakeholder groups (T13 rows; REQ-PB-070, REQ-S11-001) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "StakeholderGroupStatusQuery"], ok_schema="StakeholderGroupPage", **RD)
op(T + "/stakeholder-groups", "post", "createStakeholderGroup", "stakeholder-groups",
   "Add a T13 row: stakeholder group, impact H/M/L, influence H/M/L, current stance Support/Neutral/Resist ('Hostile' is 400), required behavior, intervention types (Comms/training/involvement/incentive), owner, adoption KPI (adoption.edit; BO, WL, TL). 409 stakeholder_group.name_taken; 422 stakeholder_group.kpi_invalid.",
   params=TP, body="StakeholderGroupCreate", ok="201", ok_desc="Created (active).", ok_schema="StakeholderGroup", etag=True, location=True, dup=True)
SG, SGP = T + "/stakeholder-groups/{stakeholderGroupId}", TP + ["StakeholderGroupId"]
op(SG, "get", "getStakeholderGroup", "stakeholder-groups", "Read one stakeholder group with its champion and open-intervention counts (transformation.read).",
   params=SGP, ok_schema="StakeholderGroup", etag=True, **RD)
op(SG, "patch", "updateStakeholderGroup", "stakeholder-groups",
   "Update a T13 row (adoption.edit). 400 stakeholder_group.stance_invalid, impact_invalid, intervention_invalid; 409 stakeholder_group.name_taken; 422 stakeholder_group.archived, kpi_invalid.",
   params=SGP, body="StakeholderGroupUpdate", ok_schema="StakeholderGroup", etag=True, if_match=True)
op(SG + "/archive", "post", "archiveStakeholderGroup", "stakeholder-groups", "Archive a group with a reason; final (adoption.edit). 422 stakeholder_group.archived.",
   params=SGP, body="AdoptionReason", ok_schema="StakeholderGroup", etag=True, if_match=True)
op(T + "/adoption-plan", "get", "getAdoptionPlan", "stakeholder-groups",
   "Template 13 Stakeholder & Adoption Plan as a register: the seven B0107 columns per active group, plus influence, champions, open interventions and open champion constraints (transformation.read).",
   params=TP, ok_schema="AdoptionPlan", **RD)
op(SG + "/champions", "get", "listStakeholderChampions", "stakeholder-groups", "The group's champions, active and removed (transformation.read).",
   params=SGP, query=["Cursor", "Limit"], ok_schema="StakeholderChampionPage", **RD)
op(SG + "/champions", "post", "addStakeholderChampion", "stakeholder-groups",
   "Name a champion of the group (adoption.edit). 409 stakeholder_champion.exists; 422 stakeholder_group.archived.",
   params=SGP, body="StakeholderChampionCreate", ok="201", ok_desc="Created (active).", ok_schema="StakeholderChampion", etag=True, location=True, dup=True)
op(SG + "/champions/{stakeholderChampionId}/remove", "post", "removeStakeholderChampion", "stakeholder-groups",
   "Remove a champion; final, the row stays as history (adoption.edit).", params=SGP + ["StakeholderChampionId"], ok_schema="StakeholderChampion", etag=True, if_match=True)
op(T + "/adoption-interventions", "get", "listAdoptionInterventions", "adoption-interventions",
   "Adoption interventions: planned by people (comms, training, involvement, incentive) and corrective ones created once per indicator, scope and period below trajectory (transformation.read).",
   params=TP, query=["Cursor", "Limit", "StakeholderGroupIdQuery", "AdoptionInterventionStatusQuery", "AdoptionInterventionOriginQuery"], ok_schema="AdoptionInterventionPage", **RD)
op(T + "/adoption-interventions", "post", "createAdoptionIntervention", "adoption-interventions",
   "Plan an intervention with owner and due date; the owner gets a My Work item (adoption.edit; REQ-S11-001).",
   params=TP, body="AdoptionInterventionCreate", ok="201", ok_desc="Created (planned).", ok_schema="AdoptionIntervention", etag=True, location=True)
AIN, AINP = T + "/adoption-interventions/{adoptionInterventionId}", TP + ["AdoptionInterventionId"]
op(AIN, "get", "getAdoptionIntervention", "adoption-interventions", "Read one intervention (transformation.read).", params=AINP, ok_schema="AdoptionIntervention", etag=True, **RD)
op(AIN, "patch", "updateAdoptionIntervention", "adoption-interventions",
   "Update an intervention: title, description, owner, due date, status (planned -> in_progress -> done; -> cancelled) with the outcome note (adoption.edit). 422 adoption_intervention.status_transition, final, outcome_required, owner_required.",
   params=AINP, body="AdoptionInterventionUpdate", ok_schema="AdoptionIntervention", etag=True, if_match=True)
op(T + "/adoption-metric-links", "get", "listAdoptionMetricLinks", "adoption-indicators",
   "Indicator measures attached to outcomes, initiatives, stakeholder groups or the transformation (REQ-S16-020 AdoptionMetricLink) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "AdoptionTargetKindQuery", "AdoptionTargetIdQuery"], ok_schema="AdoptionMetricLinkPage", **RD)
op(T + "/adoption-metric-links", "post", "createAdoptionMetricLink", "adoption-indicators",
   "Attach an indicator measure to a target; a KPI-fed measure names a KPI of the transformation or creates one from the template (createKpi) (adoption.edit). 409 adoption_metric_link.exists; 422 adoption_metric_link.kpi_required, kpi_not_applicable, kpi_mismatch.",
   params=TP, body="AdoptionMetricLinkCreate", ok="201", ok_desc="Created (active).", ok_schema="AdoptionMetricLink", etag=True, location=True, dup=True)
op(T + "/adoption-metric-links/{adoptionMetricLinkId}/remove", "post", "removeAdoptionMetricLink", "adoption-indicators",
   "Remove a link; final (adoption.edit).", params=TP + ["AdoptionMetricLinkId"], ok_schema="AdoptionMetricLink", etag=True, if_match=True)
op(T + "/adoption-indicators", "get", "getAdoptionIndicators", "adoption-indicators",
   "Adoption indicator values for a target and reporting period: KPI-fed measures with slice A's value and RAG; training completion and observed proficiency computed from records, Unknown (never 0) without records or observations (REQ-PB-072) (transformation.read).",
   params=TP, query=["AdoptionTargetKindQueryRequired", "AdoptionTargetIdQuery", "ReportingPeriodIdQuery"], ok_schema="AdoptionIndicatorReport", **RD)
op(T + "/assessment-forms", "get", "listAssessmentForms", "assessment-forms", "Feedback and proficiency-assessment forms (transformation.read).",
   params=TP, query=["Cursor", "Limit", "AssessmentFormStatusQuery"], ok_schema="AssessmentFormPage", **RD)
op(T + "/assessment-forms", "post", "createAssessmentForm", "assessment-forms",
   "Create a short native form with its first version; the questions are validated form JSON (assessment_form.manage; BO, WL). 400 assessment_form.schema_invalid.",
   params=TP, body="AssessmentFormCreate", ok="201", ok_desc="Created (draft, version 1).", ok_schema="AssessmentForm", etag=True, location=True)
AF, AFP = T + "/assessment-forms/{assessmentFormId}", TP + ["AssessmentFormId"]
op(AF, "get", "getAssessmentForm", "assessment-forms", "Read a form with its current and published versions (transformation.read).", params=AFP, ok_schema="AssessmentForm", etag=True, **RD)
op(AF, "patch", "updateAssessmentForm", "assessment-forms",
   "Edit a form; new questions insert the next version (the published version stays until published again) (assessment_form.manage). 400 assessment_form.schema_invalid; 422 assessment_form.retired.",
   params=AFP, body="AssessmentFormUpdate", ok_schema="AssessmentForm", etag=True, if_match=True)
op(AF + "/publish", "post", "publishAssessmentForm", "assessment-forms", "Publish the current version (assessment_form.manage). 422 assessment_form.retired, status_transition.",
   params=AFP, ok_schema="AssessmentForm", etag=True, if_match=True)
op(AF + "/retire", "post", "retireAssessmentForm", "assessment-forms", "Retire a form; final (assessment_form.manage). 422 assessment_form.status_transition.",
   params=AFP, ok_schema="AssessmentForm", etag=True, if_match=True)
op(AF + "/invitations", "get", "listAssessmentInvitations", "assessment-forms", "Invitations to a form (transformation.read).",
   params=AFP, query=["Cursor", "Limit"], ok_schema="AssessmentInvitationPage", **RD)
op(AF + "/invitations", "post", "createAssessmentInvitations", "assessment-forms",
   "Invite respondents to a published form for a stakeholder group (optionally naming the observed person); each invitee gets a My Work item (assessment_form.manage). 409 assessment_invitation.exists; 422 assessment_form.not_published.",
   params=AFP, body="AssessmentInvitationCreate", ok="201", ok_desc="Created (open).", ok_schema="AssessmentInvitationList", dup=True)
op(T + "/assessment-invitations/{assessmentInvitationId}/cancel", "post", "cancelAssessmentInvitation", "assessment-forms",
   "Cancel an open invitation; final (assessment_form.manage). 422 assessment_invitation.final.",
   params=TP + ["AssessmentInvitationId"], ok_schema="AssessmentInvitation", etag=True, if_match=True)
op(T + "/assessment-records", "get", "listAssessmentRecords", "assessment-records",
   "Submitted feedback and proficiency observations (transformation.read).",
   params=TP, query=["Cursor", "Limit", "StakeholderGroupIdQuery", "AssessmentFormIdQuery", "AssessmentRecordKindQuery", "AssessmentRecordStatusQuery"], ok_schema="AssessmentRecordPage", **RD)
op(T + "/assessment-records", "post", "createAssessmentRecord", "assessment-records",
   "Answer the published version of a form; a proficiency observation links to its stakeholder group and counts in the observed-proficiency measure; the result is derived from the proficiency answer (assessment.respond; invited, or an assessor holding proficiency.record). 400 assessment_record.answer_invalid, answer_required, subject_required; 403 assessment_record.not_invited; 422 assessment_form.not_published.",
   params=TP, body="AssessmentRecordCreate", ok="201", ok_desc="Created (submitted).", ok_schema="AssessmentRecord", etag=True, location=True)
AR, ARP = T + "/assessment-records/{assessmentRecordId}", TP + ["AssessmentRecordId"]
op(AR, "get", "getAssessmentRecord", "assessment-records", "Read one record (transformation.read).", params=ARP, ok_schema="AssessmentRecord", etag=True, **RD)
op(AR + "/review", "post", "reviewAssessmentRecord", "assessment-records", "Mark a record reviewed, with an optional note (assessment.review; BO). 422 assessment_record.status_transition, withdrawn.",
   params=ARP, body="AssessmentReview", ok_schema="AssessmentRecord", etag=True, if_match=True)
op(AR + "/withdraw", "post", "withdrawAssessmentRecord", "assessment-records", "Withdraw a record with a reason; it stops counting (assessment.review or the respondent). 403 assessment_record.not_withdrawable_by_caller; 422 assessment_record.withdrawn.",
   params=ARP, body="AdoptionReason", ok_schema="AssessmentRecord", etag=True, if_match=True)
op(T + "/training-records", "get", "listTrainingRecords", "assessment-records", "Training attendance records (completion is attendance, never adoption; REQ-PB-072) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "StakeholderGroupIdQuery", "TrainingRecordStatusQuery"], ok_schema="TrainingRecordPage", **RD)
op(T + "/training-records", "post", "createTrainingRecord", "assessment-records", "Enrol a participant in a training (proficiency.record; BO, WL). 422 training_record.intervention_not_training, stakeholder_group.archived.",
   params=TP, body="TrainingRecordCreate", ok="201", ok_desc="Created (enrolled).", ok_schema="TrainingRecord", etag=True, location=True)
op(T + "/training-records/{trainingRecordId}", "patch", "updateTrainingRecord", "assessment-records",
   "Record completion (with its date), no-show or withdrawal; final (proficiency.record). 422 training_record.final.",
   params=TP + ["TrainingRecordId"], body="TrainingRecordUpdate", ok_schema="TrainingRecord", etag=True, if_match=True)
op(T + "/stakeholder-involvements", "get", "listStakeholderInvolvements", "stakeholder-groups",
   "Which impacted groups took part in design workshops and T04 design decisions, with withdrawals (REQ-PB-073) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "StakeholderGroupIdQuery", "DecisionIdQuery"], ok_schema="StakeholderInvolvementPage", **RD)
op(T + "/stakeholder-involvements", "post", "createStakeholderInvolvement", "stakeholder-groups",
   "Record a group's involvement in a design workshop or T04 design decision (adoption.edit). 422 stakeholder_involvement.target_invalid.",
   params=TP, body="StakeholderInvolvementCreate", ok="201", ok_desc="Created.", ok_schema="StakeholderInvolvement", location=True)
op(T + "/stakeholder-involvements/{stakeholderInvolvementId}/withdraw", "post", "withdrawStakeholderInvolvement", "stakeholder-groups",
   "Withdraw a mistaken involvement record by appending a withdrawal; history is kept (adoption.edit). 422 stakeholder_involvement.already_withdrawn.",
   params=TP + ["StakeholderInvolvementId"], body="AdoptionReason", ok="201", ok_desc="Withdrawal appended.", ok_schema="StakeholderInvolvement")
op(T + "/champion-constraints", "get", "listChampionConstraints", "stakeholder-groups",
   "Constraints raised by champions; with decisionId, the constraints shown on that T04 decision (REQ-PB-073) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "DecisionIdQuery", "StakeholderGroupIdQuery", "ChampionConstraintStatusQuery"], ok_schema="ChampionConstraintPage", **RD)
op(T + "/champion-constraints", "post", "createChampionConstraint", "stakeholder-groups",
   "Raise a constraint on a T04 design decision as an active champion of the group (champion_constraint.raise). 403 champion_constraint.not_champion; 422 champion_constraint.decision_invalid.",
   params=TP, body="ChampionConstraintCreate", ok="201", ok_desc="Created (open).", ok_schema="ChampionConstraint", etag=True, location=True)
op(T + "/champion-constraints/{championConstraintId}/resolve", "post", "resolveChampionConstraint", "stakeholder-groups",
   "Address a constraint with a response (decision.edit) or withdraw it (its champion); final. 403 champion_constraint.not_resolvable_by_caller; 422 champion_constraint.final.",
   params=TP + ["ChampionConstraintId"], body="ChampionConstraintResolve", ok_schema="ChampionConstraint", etag=True, if_match=True)

# ======================================================================================= slice G (ADR-0034)
I = "/api/v1/initiatives/{initiativeId}"
IP = ["InitiativeId"]
op(I + "/complete-delivery", "post", "completeInitiativeDelivery", "status-model",
   "launched -> completed (delivery complete). Leaves adoption, validated value and closure unchanged (initiative.complete_delivery; WL, TL). 422 initiative.delivery_not_launched (invalid-transition).",
   params=IP, body="StatusNote", ok_schema="InitiativeStatusModel", etag=True, if_match=True)
op(I + "/adoption-status", "post", "setInitiativeAdoptionStatus", "status-model",
   "Set the business adoption status (on_track, at_risk, adopted) with a note; never derived from delivery (adoption_status.set; BO). 422 initiative.adoption_status_invalid.",
   params=IP, body="InitiativeAdoptionStatusSet", ok_schema="InitiativeStatusModel", etag=True, if_match=True)
op(I + "/status-model", "get", "getInitiativeStatusModel", "status-model",
   "The four separate statuses (delivery, adoption, validated value, closure) and the label, e.g. 'Delivered — value validation pending' (REQ-S03-003, REQ-PB-009) (transformation.read).",
   params=IP, ok_schema="InitiativeStatusModel", etag=True, **RD)
op(I + "/close", "post", "closeInitiative", "closure",
   "Close a delivery-complete initiative when each of its benefits is Finance-validated or covered by an approved transition decision, and each validated benefit has a BAU owner (initiative.close; TL). 422 invalid-transition closure.delivery_not_complete, closure.value_validation_pending, closure.sustainment_owner_missing; 409 closure.already_closed.",
   params=IP, body="StatusNote", ok="201", ok_desc="Closed; the closure record.", ok_schema="ClosureRecord", conflict="Duplicate")
op(T + "/status-model", "get", "getTransformationStatusModel", "status-model",
   "Delivery complete, value validation pending and BAU accepted as separate states, with the label (never 'successful' from initiative completion; REQ-S11-006) (transformation.read).",
   params=TP, ok_schema="TransformationStatusModel", **RD)
op(T + "/close", "post", "closeTransformation", "closure",
   "Governed closure: an approved G6 (Sustain) business approval, each benefit validated or covered by an approved transition decision, and every performance area in BAU. Sets status closed, not archived: performance areas, KPI actuals, CI backlog and lessons continue (transformation.close; TL). 422 invalid-transition closure.transformation_not_open, closure.g6_not_approved, closure.value_validation_pending, closure.bau_not_accepted; 422 transformation.archived; 409 closure.already_closed.",
   params=TP, body="StatusNote", ok="201", ok_desc="Closed; the closure record.", ok_schema="ClosureRecord", conflict="Duplicate")
op(T + "/closure-records", "get", "listClosureRecords", "closure", "The transformation's closure records (initiatives and the transformation), append-only (transformation.read).",
   params=TP, query=["Cursor", "Limit"], ok_schema="ClosureRecordPage", **RD)
op(T + "/transition-decisions", "get", "listTransitionDecisions", "transition-decisions",
   "Benefit transition decisions for long-realization benefits (REQ-S11-007) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "BenefitIdQuery", "TransitionDecisionStatusQuery"], ok_schema="TransitionDecisionPage", **RD)
op(T + "/transition-decisions", "post", "createTransitionDecision", "transition-decisions",
   "Draft a transition decision: residual owner, rationale, expected realization end, monitoring cadence (transition_decision.propose; BO, FIN). 409 transition_decision.exists; 422 transition_decision.benefit_validated, monitoring_after_end.",
   params=TP, body="TransitionDecisionCreate", ok="201", ok_desc="Created (draft).", ok_schema="TransitionDecision", etag=True, location=True, dup=True)
TD, TDP = T + "/transition-decisions/{transitionDecisionId}", TP + ["TransitionDecisionId"]
op(TD, "get", "getTransitionDecision", "transition-decisions", "Read one decision with its approval (transformation.read).", params=TDP, ok_schema="TransitionDecision", etag=True, **RD)
op(TD, "patch", "updateTransitionDecision", "transition-decisions",
   "Edit a draft, or withdraw a draft or submitted decision (status withdrawn) (transition_decision.propose). 422 transition_decision.frozen, final, monitoring_after_end.",
   params=TDP, body="TransitionDecisionUpdate", ok_schema="TransitionDecision", etag=True, if_match=True)
op(TD + "/submit", "post", "submitTransitionDecision", "transition-decisions",
   "Submit for decision through the canonical approval (type benefit_transition_decision, assignee SP by default; the requester cannot approve). The benefit's forecast stays forecast (transition_decision.propose). 422 transition_decision.final.",
   params=TDP, ok_schema="TransitionDecision", etag=True, if_match=True)
op(T + "/performance-areas", "get", "listPerformanceAreas", "performance-areas",
   "Performance areas of the transformation; they continue after the transformation closes (REQ-S03-002) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "PerformanceAreaStatusQuery"], ok_schema="PerformanceAreaPage", **RD)
op(T + "/performance-areas", "post", "createPerformanceArea", "performance-areas",
   "Create a performance area (establishing, cycle 1) (performance_area.manage; BO, TO).",
   params=TP, body="PerformanceAreaCreate", ok="201", ok_desc="Created (establishing).", ok_schema="PerformanceArea", etag=True, location=True)
PA, PAP = T + "/performance-areas/{performanceAreaId}", TP + ["PerformanceAreaId"]
op(PA, "get", "getPerformanceArea", "performance-areas",
   "Read an area with its cycle history: each cycle's prior accepted handover and the closure it followed, unchanged (REQ-S11-009) (transformation.read).",
   params=PAP, ok_schema="PerformanceArea", etag=True, **RD)
op(PA, "patch", "updatePerformanceArea", "performance-areas",
   "Update name, description, business unit, sponsor and review cadence (performance_area.manage). 422 performance_area.retired.",
   params=PAP, body="PerformanceAreaUpdate", ok_schema="PerformanceArea", etag=True, if_match=True)
op(PA + "/reopen", "post", "reopenPerformanceArea", "performance-areas",
   "Reopen a deteriorating area in BAU: a new cycle linked to the prior handover and closure; nothing is overwritten (performance_area.reopen; BO, TL). 400 performance_area.reopen_reason_required; 422 performance_area.not_reopenable (invalid-transition).",
   params=PAP, body="AdoptionReason", ok_schema="PerformanceArea", etag=True, if_match=True)
op(PA + "/retire", "post", "retirePerformanceArea", "performance-areas", "Retire an area with a reason; final (performance_area.manage). 422 performance_area.retired.",
   params=PAP, body="AdoptionReason", ok_schema="PerformanceArea", etag=True, if_match=True)
op(PA + "/links", "get", "listPerformanceAreaLinks", "performance-areas", "The area's KPIs and benefits (transformation.read).",
   params=PAP, query=["Cursor", "Limit"], ok_schema="PerformanceAreaLinkPage", **RD)
op(PA + "/links", "post", "createPerformanceAreaLink", "performance-areas", "Link a KPI or a benefit of the transformation (performance_area.manage). 409 performance_area_link.exists; 422 performance_area.retired.",
   params=PAP, body="PerformanceAreaLinkCreate", ok="201", ok_desc="Created (active).", ok_schema="PerformanceAreaLink", etag=True, location=True, dup=True)
op(PA + "/links/{performanceAreaLinkId}/remove", "post", "removePerformanceAreaLink", "performance-areas", "Remove a link; final (performance_area.manage).",
   params=PAP + ["PerformanceAreaLinkId"], ok_schema="PerformanceAreaLink", etag=True, if_match=True)
op(T + "/bau-handovers", "get", "listBauHandovers", "bau-handovers", "BAU handovers of the transformation's performance areas (transformation.read).",
   params=TP, query=["Cursor", "Limit", "PerformanceAreaIdQuery", "BauHandoverStatusQuery"], ok_schema="BauHandoverPage", **RD)
op(T + "/bau-handovers", "post", "createBauHandover", "bau-handovers",
   "Prepare a handover for the current cycle of an establishing or reopened area, naming the receiving owner (bau_handover.prepare; WL, TL). 409 bau_handover.exists; 422 bau_handover.area_not_open.",
   params=TP, body="BauHandoverCreate", ok="201", ok_desc="Created (draft).", ok_schema="BauHandover", etag=True, location=True, dup=True)
HO, HOP = T + "/bau-handovers/{bauHandoverId}", TP + ["BauHandoverId"]
op(HO, "get", "getBauHandover", "bau-handovers", "Read a handover with its controls, evidence and the area's open improvement items (transformation.read).", params=HOP, ok_schema="BauHandover", etag=True, **RD)
op(HO, "patch", "updateBauHandover", "bau-handovers",
   "Edit the M0217 content while draft or returned (bau_handover.prepare). 422 bau_handover.frozen, accepted_final.",
   params=HOP, body="BauHandoverUpdate", ok_schema="BauHandover", etag=True, if_match=True)
op(HO + "/evidence", "post", "addBauHandoverEvidence", "bau-handovers", "Link an evidence item while draft or returned (bau_handover.prepare). 422 bau_handover.frozen.",
   params=HOP, body="BauHandoverEvidenceAdd", ok="201", ok_desc="Linked.", ok_schema="BauHandover", etag=True, if_match=True)
op(HO + "/submit", "post", "submitBauHandover", "bau-handovers",
   "Submit: every M0217 item is validated (a handover missing data access is rejected); the receiving owner gets a My Work item (bau_handover.prepare). 422 bau_handover.incomplete, status_transition.",
   params=HOP, ok_schema="BauHandover", etag=True, if_match=True)
op(HO + "/accept", "post", "acceptBauHandover", "bau-handovers",
   "Receiving-owner acceptance: transfers routine ownership of the area's KPIs, controls and benefits, moves the area to BAU and creates the first recurring review exactly once (bau_handover.accept, business approval; only the receiving owner, else 403 bau_handover.not_receiving_owner). 422 bau_handover.status_transition.",
   params=HOP, body="StatusNote", ok_schema="BauHandover", etag=True, if_match=True)
op(HO + "/return", "post", "returnBauHandover", "bau-handovers",
   "Return a submitted handover with a reason (bau_handover.accept; only the receiving owner, else 403 bau_handover.not_receiving_owner). 400 bau_handover.return_reason_required; 422 bau_handover.status_transition.",
   params=HOP, body="AdoptionReason", ok_schema="BauHandover", etag=True, if_match=True)
op(T + "/controls", "get", "listControls", "controls", "BAU controls and their check cadence (transformation.read).",
   params=TP, query=["Cursor", "Limit", "PerformanceAreaIdQuery", "ControlStatusQuery"], ok_schema="ControlPage", **RD)
op(T + "/controls", "post", "createControl", "controls", "Define a control of a performance area (control.manage; BO, TO). 422 performance_area.retired.",
   params=TP, body="ControlCreate", ok="201", ok_desc="Created (active).", ok_schema="Control", etag=True, location=True)
op(T + "/controls/{controlId}", "patch", "updateControl", "controls", "Update a control, or retire it (status retired, with a reason; final) (control.manage). 422 control.retired.",
   params=TP + ["ControlId"], body="ControlUpdate", ok_schema="Control", etag=True, if_match=True)
op(T + "/control-checks", "get", "listControlChecks", "control-checks", "Periodic control checks (transformation.read).",
   params=TP, query=["Cursor", "Limit", "PerformanceAreaIdQuery", "ControlCheckStatusQuery"], ok_schema="ControlCheckPage", **RD)
op(T + "/control-checks/{controlCheckId}/record", "post", "recordControlCheck", "control-checks",
   "Record a check as passed or failed; a failed check (with its note) emits control_check.failed and slice E opens one recovery action (control_check.record; BO, TO). 400 control_check.result_note_required; 422 control_check.final.",
   params=TP + ["ControlCheckId"], body="ControlCheckRecord", ok_schema="ControlCheck", etag=True, if_match=True)
op(T + "/sustainment-reviews", "get", "listSustainmentReviews", "control-checks",
   "Recurring performance-area reviews and benefit-monitoring reviews (transformation.read).",
   params=TP, query=["Cursor", "Limit", "PerformanceAreaIdQuery", "SustainmentReviewStatusQuery"], ok_schema="SustainmentReviewPage", **RD)
op(T + "/sustainment-reviews/{sustainmentReviewId}/complete", "post", "completeSustainmentReview", "control-checks",
   "Complete a review assigned to you with its outcome note and performance signal (sustainment_review.complete). 403 sustainment_review.not_assignee; 422 sustainment_review.final.",
   params=TP + ["SustainmentReviewId"], body="SustainmentReviewComplete", ok_schema="SustainmentReview", etag=True, if_match=True)
op(T + "/improvement-items", "get", "listImprovementItems", "improvement-items",
   "The continuous-improvement backlog; it persists after transformation closure and is the list G6 shows (REQ-PB-084) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "PerformanceAreaIdQuery", "ImprovementItemStatusQuery"], ok_schema="ImprovementItemPage", **RD)
op(T + "/improvement-items", "post", "createImprovementItem", "improvement-items", "Add an improvement item with its source (improvement.edit; BO, TO).",
   params=TP, body="ImprovementItemCreate", ok="201", ok_desc="Created (open).", ok_schema="ImprovementItem", etag=True, location=True)
op(T + "/improvement-items/{improvementItemId}", "patch", "updateImprovementItem", "improvement-items",
   "Update an item or move its status; done and rejected need a resolution note and are final (improvement.edit). 400 improvement_item.resolution_note_required; 422 improvement_item.final, status_transition.",
   params=TP + ["ImprovementItemId"], body="ImprovementItemUpdate", ok_schema="ImprovementItem", etag=True, if_match=True)
op(T + "/lessons", "get", "listLessons", "lessons", "The transformation's lessons, drafts included (transformation.read).",
   params=TP, query=["Cursor", "Limit", "LessonStatusQuery"], ok_schema="LessonPage", **RD)
op(T + "/lessons", "post", "createLesson", "lessons", "Record a lesson (draft) (lesson.edit; BO, TO).",
   params=TP, body="LessonCreate", ok="201", ok_desc="Created (draft).", ok_schema="Lesson", etag=True, location=True)
op(T + "/lessons/{lessonId}", "patch", "updateLesson", "lessons", "Edit a lesson, or archive it (status archived; final) (lesson.edit). 422 lesson.archived, status_transition.",
   params=TP + ["LessonId"], body="LessonUpdate", ok_schema="Lesson", etag=True, if_match=True)
op(T + "/lessons/{lessonId}/publish", "post", "publishLesson", "lessons", "Publish a lesson; it becomes searchable from other transformations (lesson.edit). 422 lesson.status_transition.",
   params=TP + ["LessonId"], ok_schema="Lesson", etag=True, if_match=True)
op("/api/v1/lessons/search", "get", "searchLessons", "lessons",
   "Full-text search over the published lessons of every transformation in the caller's scope, across transformations (REQ-S11-008) (lesson.search; every business role and AUD).",
   query=["LessonSearchQ", "LessonTagQuery", "Cursor", "Limit"], ok_schema="LessonSearchPage", not_found=False, rule=False)
def enum(*v): return "{ type: string, enum: [%s] }" % ", ".join(v)
PARAMS = {
    "StakeholderGroupId": ("stakeholderGroupId", "path", UUID),
    "StakeholderChampionId": ("stakeholderChampionId", "path", UUID),
    "AdoptionInterventionId": ("adoptionInterventionId", "path", UUID),
    "AdoptionMetricLinkId": ("adoptionMetricLinkId", "path", UUID),
    "AssessmentFormId": ("assessmentFormId", "path", UUID),
    "AssessmentInvitationId": ("assessmentInvitationId", "path", UUID),
    "AssessmentRecordId": ("assessmentRecordId", "path", UUID),
    "TrainingRecordId": ("trainingRecordId", "path", UUID),
    "StakeholderInvolvementId": ("stakeholderInvolvementId", "path", UUID),
    "ChampionConstraintId": ("championConstraintId", "path", UUID),
    "TransitionDecisionId": ("transitionDecisionId", "path", UUID),
    "PerformanceAreaId": ("performanceAreaId", "path", UUID),
    "PerformanceAreaLinkId": ("performanceAreaLinkId", "path", UUID),
    "BauHandoverId": ("bauHandoverId", "path", UUID),
    "ControlId": ("controlId", "path", UUID),
    "ControlCheckId": ("controlCheckId", "path", UUID),
    "SustainmentReviewId": ("sustainmentReviewId", "path", UUID),
    "ImprovementItemId": ("improvementItemId", "path", UUID),
    "LessonId": ("lessonId", "path", UUID),
    "StakeholderGroupStatusQuery": ("status", "query", enum("active", "archived")),
    "StakeholderGroupIdQuery": ("stakeholderGroupId", "query", UUID),
    "AdoptionInterventionStatusQuery": ("status", "query", enum("planned", "in_progress", "done", "cancelled")),
    "AdoptionInterventionOriginQuery": ("origin", "query", enum("manual", "below_trajectory")),
    "AdoptionTargetKindQuery": ("targetKind", "query", enum("transformation", "outcome", "initiative", "stakeholder_group")),
    "AdoptionTargetKindQueryRequired": ("targetKind", "query", enum("transformation", "outcome", "initiative", "stakeholder_group"), True),
    "AdoptionTargetIdQuery": ("targetId", "query", UUID),
    "AssessmentFormStatusQuery": ("status", "query", enum("draft", "published", "retired")),
    "AssessmentFormIdQuery": ("assessmentFormId", "query", UUID),
    "AssessmentRecordKindQuery": ("kind", "query", enum("feedback", "proficiency_observation")),
    "AssessmentRecordStatusQuery": ("status", "query", enum("submitted", "reviewed", "withdrawn")),
    "TrainingRecordStatusQuery": ("status", "query", enum("enrolled", "completed", "no_show", "withdrawn")),
    "ChampionConstraintStatusQuery": ("status", "query", enum("open", "addressed", "withdrawn")),
    "BenefitIdQuery": ("benefitId", "query", UUID),
    "TransitionDecisionStatusQuery": ("status", "query", enum("draft", "submitted", "approved", "rejected", "withdrawn")),
    "PerformanceAreaStatusQuery": ("status", "query", enum("establishing", "bau", "reopened", "retired")),
    "PerformanceAreaIdQuery": ("performanceAreaId", "query", UUID),
    "BauHandoverStatusQuery": ("status", "query", enum("draft", "submitted", "accepted", "returned")),
    "ControlStatusQuery": ("status", "query", enum("active", "retired")),
    "ControlCheckStatusQuery": ("status", "query", enum("due", "passed", "failed", "cancelled")),
    "SustainmentReviewStatusQuery": ("status", "query", enum("due", "done", "cancelled")),
    "ImprovementItemStatusQuery": ("status", "query", enum("open", "in_progress", "done", "rejected")),
    "LessonStatusQuery": ("status", "query", enum("draft", "published", "archived")),
    "LessonSearchQ": ("q", "query", "{ type: string, minLength: 1, maxLength: 200 }"),
    "LessonTagQuery": ("tag", "query", "{ type: string, minLength: 1, maxLength: 50 }"),
}

U = '{ $ref: "#/components/schemas/Uuid" }'
NU = '{ $ref: "#/components/schemas/NullableUuid" }'
TS = '{ $ref: "#/components/schemas/Timestamp" }'
NTS = '{ $ref: "#/components/schemas/NullableTimestamp" }'
BD = '{ $ref: "#/components/schemas/BusinessDate" }'
NBD = '{ $ref: "#/components/schemas/NullableBusinessDate" }'
V = '{ $ref: "#/components/schemas/Version" }'
ND = '{ $ref: "#/components/schemas/NullableDecimal" }'
def S(n, a=1, b=2000): return "{ type: string, minLength: %d, maxLength: %d }" % (a, b)
def NS(n=None, a=1, b=2000): return '{ type: [string, "null"], minLength: %d, maxLength: %d }' % (a, b)
def EN(*v, null=False):
    if null: return '{ type: [string, "null"], enum: [%s, null] }' % ", ".join(v)
    return "{ type: string, enum: [%s] }" % ", ".join(v)
HML = EN("H", "M", "L")
FREQ = EN("weekly", "monthly", "quarterly", "semi_annual", "annual")
STAMPS = [("version", V), ("createdAt", TS), ("createdBy", NU), ("updatedAt", TS), ("updatedBy", NU)]

def obj(name, desc, props, required=None, extra=""):
    req = required if required is not None else [k for k, _ in props]
    lines = [f"    {name}:", "      type: object"]
    if desc: lines.append(f'      description: "{desc}"')
    if req: lines.append(f"      required: [{', '.join(req)}]")
    lines.append("      additionalProperties: false")
    if extra: lines.append(extra)
    lines.append("      properties:")
    for k, t in props:
        lines.append(f"        {k}: {t}")
    return "\n".join(lines) + "\n"
def ref(n): return '{ $ref: "#/components/schemas/%s" }' % n
def arr(t, a=None, b=None):
    s = "{ type: array, items: %s" % t
    if a is not None: s += f", minItems: {a}"
    if b is not None: s += f", maxItems: {b}"
    return s + " }"

SCH = ["    # ---- P4 slices F and G (T-DG4-ARCH-06; ADR-0033, ADR-0034) ----------------------------------------------------\n"]
add = SCH.append
add(obj("AdoptionReason", "A reason (3-1000 characters; shared free-text rules).", [("reason", S(0, 3, 1000))]))
add(obj("StatusNote", "An optional note on a status action (shared free-text rules).", [("note", S(0, 1, 2000))], required=[]))
# templates
add(obj("AdoptionIndicatorTemplate", "One measure of a seeded leading adoption indicator (B0109-B0115 verbatim in sourceIndicatorEn; Arabic provisional).",
    [("key", "{ type: string }"), ("indicatorKey", "{ type: string }"), ("indicatorOrdinal", "{ type: integer, minimum: 1, maximum: 7 }"),
     ("measureOrdinal", "{ type: integer, minimum: 1, maximum: 2 }"), ("sourceIndicatorEn", "{ type: string }"), ("indicatorAr", "{ type: string }"),
     ("measureEn", "{ type: string }"), ("measureAr", "{ type: string }"), ("arProvisional", "{ type: boolean }"), ("unitKind", EN("percentage", "duration")),
     ("polarity", EN("higher_is_better", "lower_is_better")), ("valueNature", EN("ratio", "stock")), ("aggregationRule", EN("weighted_ratio", "last_value")),
     ("valueSource", EN("kpi_actuals", "training_records", "assessment_records")), ("sourceRef", "{ type: string }")]))
add(obj("AdoptionIndicatorTemplateList", None, [("items", arr(ref("AdoptionIndicatorTemplate")))]))
# stakeholder groups
SGF = [("name", S(0, 1, 200)), ("description", NS(b=4000)), ("influence", EN("H", "M", "L", null=True)), ("impact", HML),
       ("currentStance", EN("support", "neutral", "resist")), ("requiredBehavior", S(0, 1, 2000)),
       ("interventionTypes", "{ type: array, minItems: 1, maxItems: 4, uniqueItems: true, items: { type: string, enum: [comms, training, involvement, incentive] } }"),
       ("interventionPlan", NS(b=8000)), ("ownerUserId", U), ("adoptionKpiDefinitionId", NU), ("headcount", '{ type: [integer, "null"], minimum: 1, maximum: 10000000 }')]
add(obj("StakeholderGroup", "A T13 row (REQ-PB-070, REQ-S11-001, REQ-S16-020 StakeholderGroup).",
    [("id", U), ("transformationId", U), ("code", "{ type: string, pattern: \"^SG-[0-9]{2,6}$\" }")] + SGF +
    [("championCount", "{ type: integer, minimum: 0 }"), ("openInterventionCount", "{ type: integer, minimum: 0 }"), ("status", EN("active", "archived")),
     ("archivedAt", NTS), ("archiveReason", NS(b=1000))] + STAMPS))
add(obj("StakeholderGroupCreate", None, SGF, required=["name", "impact", "currentStance", "requiredBehavior", "interventionTypes", "ownerUserId"]))
add(obj("StakeholderGroupUpdate", "Every member optional; at least one.", SGF, required=[], extra="      minProperties: 1"))
add(obj("AdoptionPlanRow", "The seven B0107 columns (Stakeholder, Impact, Current stance, Required behavior, Intervention, Owner, Adoption KPI) plus influence and counts.",
    [("stakeholderGroupId", U), ("code", "{ type: string }"), ("stakeholder", "{ type: string }"), ("impact", HML), ("influence", EN("H", "M", "L", null=True)),
     ("currentStance", EN("support", "neutral", "resist")), ("requiredBehavior", "{ type: string }"),
     ("intervention", "{ type: array, items: { type: string, enum: [comms, training, involvement, incentive] } }"), ("ownerUserId", U),
     ("adoptionKpiDefinitionId", NU), ("adoptionKpiName", '{ type: [string, "null"] }'), ("championCount", "{ type: integer, minimum: 0 }"),
     ("openInterventionCount", "{ type: integer, minimum: 0 }"), ("openChampionConstraintCount", "{ type: integer, minimum: 0 }")]))
add(obj("AdoptionPlan", "Template 13 Stakeholder & Adoption Plan of a transformation.", [("transformationId", U), ("rows", arr(ref("AdoptionPlanRow")))]))
add(obj("StakeholderChampion", None, [("id", U), ("transformationId", U), ("stakeholderGroupId", U), ("userId", U), ("note", NS(b=1000)),
    ("status", EN("active", "removed")), ("removedAt", NTS), ("removedBy", NU)] + STAMPS))
add(obj("StakeholderChampionCreate", None, [("userId", U), ("note", NS(b=1000))], required=["userId"]))
# interventions
add(obj("AdoptionIntervention", "An adoption intervention (REQ-S16-020 AdoptionIntervention). origin below_trajectory: created once per indicator, scope and period by the worker; ownerStatus unassigned when no owner resolved; dueDate null = Unknown.",
    [("id", U), ("transformationId", U), ("code", "{ type: string }"), ("stakeholderGroupId", NU),
     ("interventionType", EN("comms", "training", "involvement", "incentive", "corrective")), ("title", S(0, 1, 500)), ("description", NS(b=8000)),
     ("ownerUserId", NU), ("ownerStatus", EN("assigned", "unassigned")), ("dueDate", NBD), ("dueUnknownReason", '{ type: [string, "null"], enum: [calendar_not_configured, null] }'),
     ("status", EN("planned", "in_progress", "done", "cancelled")), ("origin", EN("manual", "below_trajectory")), ("metricLinkId", NU), ("kpiEvaluationId", NU),
     ("reportingPeriodId", NU), ("scopeKind", EN("transformation", "business_unit", "initiative", null=True)), ("scopeId", NU), ("outcomeNote", NS(b=2000)),
     ("completedAt", NTS), ("completedBy", NU), ("createdSource", EN("api", "worker"))] + STAMPS))
AIF = [("stakeholderGroupId", NU), ("interventionType", EN("comms", "training", "involvement", "incentive")), ("title", S(0, 1, 500)),
       ("description", NS(b=8000)), ("ownerUserId", U), ("dueDate", BD)]
add(obj("AdoptionInterventionCreate", None, AIF, required=["interventionType", "title", "ownerUserId", "dueDate"]))
add(obj("AdoptionInterventionUpdate", "Every member optional; at least one. A worker intervention keeps its type.",
    [("title", S(0, 1, 500)), ("description", NS(b=8000)), ("ownerUserId", U), ("dueDate", BD), ("status", EN("in_progress", "done", "cancelled")),
     ("outcomeNote", S(0, 3, 2000))], required=[], extra="      minProperties: 1"))
# metric links / indicators
add(obj("AdoptionMetricLink", "An indicator measure attached to a target (REQ-S16-020 AdoptionMetricLink).",
    [("id", U), ("transformationId", U), ("templateKey", "{ type: string }"), ("kpiDefinitionId", NU),
     ("targetKind", EN("transformation", "outcome", "initiative", "stakeholder_group")), ("targetId", U), ("status", EN("active", "removed")),
     ("removedAt", NTS), ("removedBy", NU)] + STAMPS))
add(obj("AdoptionMetricLinkCreate", "Name kpiDefinitionId, or createKpi with kpiOwnerUserId, for a KPI-fed measure; neither for a record-fed measure. targetId is required unless targetKind is transformation.",
    [("templateKey", "{ type: string, pattern: \"^[a-z_]+$\" }"), ("targetKind", EN("transformation", "outcome", "initiative", "stakeholder_group")),
     ("targetId", U), ("kpiDefinitionId", U), ("createKpi", "{ type: boolean }"), ("kpiOwnerUserId", U)], required=["templateKey", "targetKind"]))
add(obj("AdoptionMeasureValue", "One measure's value: a decimal string (fractions for percentages) or null when Unknown (never 0). calculatedRag is slice A's for KPI-fed measures and null for record-fed ones.",
    [("templateKey", "{ type: string }"), ("metricLinkId", NU), ("kpiDefinitionId", NU), ("value", ND),
     ("valueStatus", EN("ok", "unknown", "stale", "not_computable")), ("valueReason", '{ type: [string, "null"] }'),
     ("calculatedRag", EN("green", "amber", "red", "unknown", "stale", "not_computable", null=True)), ("trajectoryValue", ND),
     ("numerator", '{ type: [integer, "null"], minimum: 0 }'), ("denominator", '{ type: [integer, "null"], minimum: 0 }')]))
add(obj("AdoptionIndicatorReport", None, [("targetKind", EN("transformation", "outcome", "initiative", "stakeholder_group")), ("targetId", U),
    ("reportingPeriodId", U), ("measures", arr(ref("AdoptionMeasureValue")))]))
# forms
add(obj("AssessmentQuestionOption", None, [("value", "{ type: string, pattern: \"^[a-z0-9_]{1,40}$\" }"), ("label_en", S(0, 1, 200)), ("label_ar", S(0, 1, 200))]))
add(obj("AssessmentQuestion", "One question of a versioned form (validated form JSON, ADR-0033 §5). options only for single_choice; min/max only for scale; pass_min only for a scale proficiency question.",
    [("key", "{ type: string, pattern: \"^[a-z][a-z0-9_]{0,39}$\" }"), ("type", EN("single_choice", "scale", "yes_no", "text")),
     ("label_en", S(0, 1, 500)), ("label_ar", S(0, 1, 500)), ("required", "{ type: boolean }"),
     ("options", "{ type: array, minItems: 2, maxItems: 10, items: { $ref: \"#/components/schemas/AssessmentQuestionOption\" } }"),
     ("min", "{ type: integer, minimum: 0, maximum: 10 }"), ("max", "{ type: integer, minimum: 0, maximum: 10 }"),
     ("proficiency", "{ type: boolean }"), ("pass_min", "{ type: integer, minimum: 0, maximum: 10 }")], required=["key", "type", "label_en", "label_ar", "required"]))
add(obj("AssessmentFormSchema", None, [("questions", "{ type: array, minItems: 1, maxItems: 20, items: { $ref: \"#/components/schemas/AssessmentQuestion\" } }")]))
add(obj("AssessmentFormVersion", "An append-only question set.", [("versionNo", "{ type: integer, minimum: 1 }"), ("schema", ref("AssessmentFormSchema")),
    ("createdAt", TS), ("createdBy", U)]))
add(obj("AssessmentForm", "A short native feedback or proficiency-assessment form (REQ-S11-002).",
    [("id", U), ("transformationId", U), ("kind", EN("feedback", "proficiency_assessment")), ("name", S(0, 1, 200)), ("description", NS(b=2000)),
     ("stakeholderGroupId", NU), ("status", EN("draft", "published", "retired")), ("currentVersion", ref("AssessmentFormVersion")),
     ("publishedVersionNo", '{ type: [integer, "null"], minimum: 1 }'), ("publishedAt", NTS), ("publishedBy", NU), ("retiredAt", NTS), ("retiredBy", NU)] + STAMPS))
add(obj("AssessmentFormCreate", None, [("kind", EN("feedback", "proficiency_assessment")), ("name", S(0, 1, 200)), ("description", NS(b=2000)),
    ("stakeholderGroupId", NU), ("schema", ref("AssessmentFormSchema"))], required=["kind", "name", "schema"]))
add(obj("AssessmentFormUpdate", "Every member optional; at least one. A schema inserts the next version.", [("name", S(0, 1, 200)), ("description", NS(b=2000)),
    ("stakeholderGroupId", NU), ("schema", ref("AssessmentFormSchema"))], required=[], extra="      minProperties: 1"))
add(obj("AssessmentInvitation", None, [("id", U), ("transformationId", U), ("formId", U), ("userId", U), ("stakeholderGroupId", U), ("subjectUserId", NU),
    ("dueDate", NBD), ("status", EN("open", "responded", "cancelled"))] + STAMPS))
add(obj("AssessmentInvitationCreate", None, [("userIds", "{ type: array, minItems: 1, maxItems: 100, uniqueItems: true, items: { $ref: \"#/components/schemas/Uuid\" } }"),
    ("stakeholderGroupId", U), ("subjectUserId", NU), ("dueDate", NBD)], required=["userIds", "stakeholderGroupId"]))
add(obj("AssessmentInvitationList", None, [("items", arr(ref("AssessmentInvitation")))]))
add(obj("AssessmentRecord", "A submitted response (REQ-S16-020 Training/AssessmentRecord, assessment half). proficiencyResult is derived from the proficiency answer.",
    [("id", U), ("transformationId", U), ("formId", U), ("formVersionNo", "{ type: integer, minimum: 1 }"), ("invitationId", NU), ("stakeholderGroupId", U),
     ("kind", EN("feedback", "proficiency_observation")), ("respondentUserId", U), ("subjectUserId", NU), ("subjectLabel", NS(b=200)), ("observedOn", BD),
     ("answers", "{ type: object, additionalProperties: { type: [string, integer, boolean] } }"),
     ("proficiencyResult", EN("proficient", "not_yet_proficient", null=True)), ("status", EN("submitted", "reviewed", "withdrawn")),
     ("reviewedAt", NTS), ("reviewedBy", NU), ("reviewNote", NS(b=2000)), ("withdrawnAt", NTS), ("withdrawnBy", NU), ("withdrawReason", NS(b=1000))] + STAMPS))
add(obj("AssessmentRecordCreate", "Answers keyed by question key: a string (single_choice value or text), an integer (scale) or a boolean (yes_no).",
    [("formId", U), ("invitationId", U), ("stakeholderGroupId", U), ("subjectUserId", U), ("subjectLabel", S(0, 1, 200)), ("observedOn", BD),
     ("answers", "{ type: object, maxProperties: 20, additionalProperties: { type: [string, integer, boolean] } }")],
    required=["formId", "stakeholderGroupId", "observedOn", "answers"]))
add(obj("AssessmentReview", None, [("note", S(0, 1, 2000))], required=[]))
add(obj("TrainingRecord", "A training attendance record (REQ-S16-020 Training/AssessmentRecord, training half). Completion is attendance, never adoption.",
    [("id", U), ("transformationId", U), ("stakeholderGroupId", U), ("interventionId", NU), ("participantUserId", NU), ("participantLabel", NS(b=200)),
     ("trainingTitle", S(0, 1, 300)), ("scheduledOn", NBD), ("status", EN("enrolled", "completed", "no_show", "withdrawn")), ("completedOn", NBD),
     ("recordedBy", NU)] + STAMPS))
add(obj("TrainingRecordCreate", "Exactly one of participantUserId and participantLabel.", [("stakeholderGroupId", U), ("interventionId", U), ("participantUserId", U),
    ("participantLabel", S(0, 1, 200)), ("trainingTitle", S(0, 1, 300)), ("scheduledOn", BD)], required=["stakeholderGroupId", "trainingTitle"]))
add(obj("TrainingRecordUpdate", "completedOn is required exactly when status is completed.", [("status", EN("completed", "no_show", "withdrawn")), ("completedOn", BD)], required=["status"]))
add(obj("StakeholderInvolvement", None, [("id", U), ("transformationId", U), ("stakeholderGroupId", U), ("involvementKind", EN("workshop", "decision")),
    ("workshopId", NU), ("decisionId", NU), ("note", NS(b=2000)), ("withdrawsInvolvementId", NU), ("withdrawn", "{ type: boolean }"), ("createdAt", TS), ("createdBy", U)]))
add(obj("StakeholderInvolvementCreate", "Exactly one of workshopId and decisionId (a T04 design decision).", [("stakeholderGroupId", U), ("workshopId", U), ("decisionId", U),
    ("note", S(0, 1, 2000))], required=["stakeholderGroupId"]))
add(obj("ChampionConstraint", "A champion's constraint on a T04 design decision (REQ-PB-073).", [("id", U), ("transformationId", U), ("championId", U), ("stakeholderGroupId", U),
    ("decisionId", U), ("decisionCode", "{ type: string }"), ("constraintText", S(0, 3, 4000)), ("status", EN("open", "addressed", "withdrawn")),
    ("responseText", NS(b=4000)), ("resolvedAt", NTS), ("resolvedBy", NU)] + STAMPS))
add(obj("ChampionConstraintCreate", None, [("championId", U), ("decisionId", U), ("constraintText", S(0, 3, 4000))]))
add(obj("ChampionConstraintResolve", "responseText is required exactly when outcome is addressed.", [("outcome", EN("addressed", "withdrawn")), ("responseText", S(0, 3, 4000))], required=["outcome"]))
# slice G
add(obj("InitiativeAdoptionStatusSet", None, [("adoptionStatus", EN("on_track", "at_risk", "adopted")), ("note", S(0, 1, 2000))], required=["adoptionStatus"]))
add(obj("InitiativeStatusModel", "Four separate statuses (REQ-S03-003). label: Closed | Delivered — value validation pending | Delivered — value validated | In delivery.",
    [("initiativeId", U), ("version", V), ("delivery", "{ type: string }"), ("deliveryCompletedAt", NTS), ("deliveryCompletedBy", NU),
     ("adoption", EN("not_assessed", "on_track", "at_risk", "adopted")), ("adoptionSource", EN("owner", "indicator")),
     ("value", EN("no_benefit", "validation_pending", "validated", "validated_with_transition")), ("closure", EN("open", "closed")), ("closureRecordId", NU),
     ("label", EN("Closed", '"Delivered — value validation pending"', '"Delivered — value validated"', '"In delivery"'))]))
add(obj("TransformationStatusModel", "Delivery complete, value validation pending and BAU accepted as separate states (REQ-S11-006); no label says successful.",
    [("transformationId", U), ("deliveryState", EN("in_delivery", "delivery_complete")),
     ("valueState", EN("no_benefit", "validation_pending", "validated", "validated_with_transition")), ("bauState", EN("no_performance_area", "bau_pending", "bau_accepted")),
     ("closureState", EN("open", "closed")),
     ("label", EN("Closed", '"Delivery complete - value validation pending"', '"Value validated - BAU acceptance pending"', '"Value validated - BAU accepted"', '"In delivery"')),
     ("initiatives", "{ type: object, required: [total, completed], additionalProperties: false, properties: { total: { type: integer, minimum: 0 }, completed: { type: integer, minimum: 0 } } }"),
     ("performanceAreas", "{ type: object, required: [total, bau], additionalProperties: false, properties: { total: { type: integer, minimum: 0 }, bau: { type: integer, minimum: 0 } } }")]))
add(obj("ClosureRecord", "A governed closure (append-only).", [("id", U), ("transformationId", U), ("subjectKind", EN("initiative", "transformation")), ("initiativeId", NU),
    ("basis", EN("validated_value", "transition_decision", "validated_value_and_transition_decision")), ("snapshot", "{ type: object }"),
    ("closureNote", NS(b=2000)), ("closedAt", TS), ("closedBy", U)]))
TDF = [("residualOwnerUserId", U), ("rationale", S(0, 3, 4000)), ("expectedRealizationEnd", BD), ("monitoringFrequency", FREQ),
       ("monitoringInterval", "{ type: integer, minimum: 1, maximum: 12 }"), ("firstMonitoringDate", BD)]
add(obj("TransitionDecision", "A documented transition decision for a long-realization benefit (REQ-S11-007). The benefit's forecast stays forecast.",
    [("id", U), ("transformationId", U), ("code", "{ type: string }"), ("benefitId", U)] + TDF +
    [("nextMonitoringDate", NBD), ("status", EN("draft", "submitted", "approved", "rejected", "withdrawn")), ("approvalId", NU), ("decidedAt", NTS), ("decidedBy", NU)] + STAMPS))
add(obj("TransitionDecisionCreate", None, [("benefitId", U)] + TDF, required=["benefitId", "residualOwnerUserId", "rationale", "expectedRealizationEnd", "monitoringFrequency", "firstMonitoringDate"]))
add(obj("TransitionDecisionUpdate", "Every member optional; at least one. status withdrawn withdraws a draft or submitted decision.", TDF + [("status", EN("withdrawn"))], required=[], extra="      minProperties: 1"))
PAF = [("name", S(0, 1, 200)), ("description", NS(b=4000)), ("businessUnitId", NU), ("sponsorUserId", NU), ("reviewFrequency", FREQ),
       ("reviewInterval", "{ type: integer, minimum: 1, maximum: 12 }")]
add(obj("PerformanceAreaCycle", "One cycle of an area (append-only): the prior accepted handover and the closure it followed, as they were.",
    [("cycleNo", "{ type: integer, minimum: 1 }"), ("openedAt", TS), ("openedBy", U), ("reopenReason", NS(b=2000)), ("priorHandoverId", NU),
     ("priorHandoverAcceptedAt", NTS), ("priorHandoverAcceptedBy", NU), ("priorClosureRecordId", NU), ("priorClosedAt", NTS)]))
add(obj("PerformanceArea", "A performance area; it continues after its transformation closes (REQ-S03-002). transformationId is the origin.",
    [("id", U), ("transformationId", U), ("code", "{ type: string }")] + PAF +
    [("bauOwnerUserId", NU), ("kpiOwnerUserId", NU), ("nextReviewDate", NBD), ("cycleNo", "{ type: integer, minimum: 1 }"),
     ("status", EN("establishing", "bau", "reopened", "retired")), ("currentHandoverId", NU), ("cycles", arr(ref("PerformanceAreaCycle"))),
     ("retiredAt", NTS), ("retireReason", NS(b=1000))] + STAMPS))
add(obj("PerformanceAreaCreate", None, PAF, required=["name"]))
add(obj("PerformanceAreaUpdate", "Every member optional; at least one.", PAF, required=[], extra="      minProperties: 1"))
add(obj("PerformanceAreaLink", None, [("id", U), ("transformationId", U), ("performanceAreaId", U), ("linkKind", EN("kpi", "benefit")), ("kpiDefinitionId", NU),
    ("benefitId", NU), ("status", EN("active", "removed")), ("removedAt", NTS), ("removedBy", NU)] + STAMPS))
add(obj("PerformanceAreaLinkCreate", "Exactly one of kpiDefinitionId and benefitId, matching linkKind.", [("linkKind", EN("kpi", "benefit")), ("kpiDefinitionId", U), ("benefitId", U)], required=["linkKind"]))
HOF = [("receivingOwnerUserId", U), ("kpiOwnerUserId", NU), ("operatingProcedures", NS(b=8000)), ("capabilityReadiness", NS(b=8000)),
       ("unresolvedAcceptedRisks", NS(b=8000)), ("benefitMonitoringCadence", '{ type: [string, "null"], enum: [weekly, monthly, quarterly, semi_annual, annual, null] }'),
       ("dataAccess", NS(b=8000)), ("improvementBacklogSummary", NS(b=8000))]
add(obj("BauHandover", "A BAU handover with the M0217 content and receiving-owner acceptance (REQ-PB-083, REQ-S11-005).",
    [("id", U), ("transformationId", U), ("performanceAreaId", U), ("cycleNo", "{ type: integer, minimum: 1 }"), ("code", "{ type: string }")] + HOF +
    [("controlIds", arr(U)), ("evidenceIds", arr(U)), ("openImprovementItemIds", arr(U)), ("missingItems", "{ type: array, items: { type: string, enum: [kpi_owner, operating_procedures, controls, evidence, capability_readiness, unresolved_accepted_risks, benefit_monitoring_cadence, data_access, improvement_backlog] } }"),
     ("status", EN("draft", "submitted", "accepted", "returned")), ("submittedAt", NTS), ("submittedBy", NU), ("acceptedAt", NTS), ("acceptedBy", NU),
     ("acceptanceNote", NS(b=2000)), ("returnedAt", NTS), ("returnedBy", NU), ("returnReason", NS(b=2000))] + STAMPS))
add(obj("BauHandoverCreate", None, [("performanceAreaId", U)] + HOF, required=["performanceAreaId", "receivingOwnerUserId"]))
add(obj("BauHandoverUpdate", "Every member optional; at least one.", HOF, required=[], extra="      minProperties: 1"))
add(obj("BauHandoverEvidenceAdd", None, [("evidenceId", U)]))
CTF = [("name", S(0, 1, 300)), ("description", NS(b=4000)), ("ownerUserId", NU), ("frequency", FREQ), ("frequencyInterval", "{ type: integer, minimum: 1, maximum: 12 }"),
       ("nextCheckDate", NBD)]
add(obj("Control", "A BAU control and its check cadence.", [("id", U), ("transformationId", U), ("performanceAreaId", U), ("code", "{ type: string }")] + CTF +
    [("status", EN("active", "retired")), ("retiredAt", NTS), ("retireReason", NS(b=1000))] + STAMPS))
add(obj("ControlCreate", None, [("performanceAreaId", U)] + CTF, required=["performanceAreaId", "name", "frequency"]))
add(obj("ControlUpdate", "Every member optional; at least one. status retired needs retireReason.", CTF + [("status", EN("retired")), ("retireReason", S(0, 3, 1000))],
    required=[], extra="      minProperties: 1"))
add(obj("ControlCheck", "One periodic check of a control for one due date.", [("id", U), ("transformationId", U), ("controlId", U), ("performanceAreaId", U), ("dueDate", BD),
    ("assigneeUserId", NU), ("status", EN("due", "passed", "failed", "cancelled")), ("performedAt", NTS), ("performedBy", NU), ("resultNote", NS(b=4000)),
    ("correctiveCaseId", NU), ("createdSource", EN("api", "worker"))] + STAMPS))
add(obj("ControlCheckRecord", "resultNote is required when result is failed.", [("result", EN("passed", "failed")), ("resultNote", S(0, 3, 4000))], required=["result"]))
add(obj("SustainmentReview", "A recurring performance-area review or benefit-monitoring review.", [("id", U), ("transformationId", U),
    ("subjectKind", EN("performance_area", "transition_decision")), ("performanceAreaId", NU), ("cycleNo", '{ type: [integer, "null"], minimum: 1 }'),
    ("transitionDecisionId", NU), ("dueDate", BD), ("assigneeUserId", U), ("status", EN("due", "done", "cancelled")), ("completedAt", NTS), ("completedBy", NU),
    ("outcomeNote", NS(b=4000)), ("performanceSignal", EN("on_track", "deteriorating", "unknown", null=True)), ("createdSource", EN("api", "worker"))] + STAMPS))
add(obj("SustainmentReviewComplete", None, [("outcomeNote", S(0, 3, 4000)), ("performanceSignal", EN("on_track", "deteriorating", "unknown"))]))
IIF = [("performanceAreaId", NU), ("title", S(0, 1, 300)), ("description", NS(b=8000)), ("ownerUserId", NU), ("priority", EN("H", "M", "L", null=True)), ("targetDate", NBD)]
add(obj("ImprovementItem", "A continuous-improvement backlog item (REQ-PB-084).", [("id", U), ("transformationId", U), ("code", "{ type: string }")] + IIF +
    [("sourceKind", EN("manual", "lesson", "control_check", "review", "handover")), ("sourceId", NU), ("status", EN("open", "in_progress", "done", "rejected")),
     ("resolutionNote", NS(b=2000)), ("resolvedAt", NTS), ("resolvedBy", NU)] + STAMPS))
add(obj("ImprovementItemCreate", "sourceId names the lesson, control check, review or handover; absent for manual.", IIF + [("sourceKind", EN("manual", "lesson", "control_check", "review", "handover")),
    ("sourceId", U)], required=["title", "sourceKind"]))
add(obj("ImprovementItemUpdate", "Every member optional; at least one.", IIF + [("status", EN("open", "in_progress", "done", "rejected")), ("resolutionNote", S(0, 3, 2000))],
    required=[], extra="      minProperties: 1"))
LF = [("performanceAreaId", NU), ("title", S(0, 1, 300)), ("context", NS(b=4000)), ("lessonText", S(0, 3, 8000)), ("recommendation", NS(b=4000)),
      ("tags", "{ type: array, maxItems: 10, uniqueItems: true, items: { type: string, minLength: 1, maxLength: 50 } }")]
add(obj("Lesson", "A lesson; published lessons are searchable across transformations (REQ-S11-008).", [("id", U), ("transformationId", U), ("code", "{ type: string }")] + LF +
    [("status", EN("draft", "published", "archived")), ("publishedAt", NTS), ("publishedBy", NU), ("archivedAt", NTS), ("archivedBy", NU)] + STAMPS))
add(obj("LessonCreate", None, LF, required=["title", "lessonText"]))
add(obj("LessonUpdate", "Every member optional; at least one. status archived archives (final).", LF + [("status", EN("archived"))], required=[], extra="      minProperties: 1"))
add(obj("LessonSearchHit", "A published lesson found across transformations.", [("lesson", ref("Lesson")), ("transformationCode", "{ type: string }"),
    ("transformationName", "{ type: string }")]))
for name, item in [("StakeholderGroupPage", "StakeholderGroup"), ("StakeholderChampionPage", "StakeholderChampion"), ("AdoptionInterventionPage", "AdoptionIntervention"),
                   ("AdoptionMetricLinkPage", "AdoptionMetricLink"), ("AssessmentFormPage", "AssessmentForm"), ("AssessmentInvitationPage", "AssessmentInvitation"),
                   ("AssessmentRecordPage", "AssessmentRecord"), ("TrainingRecordPage", "TrainingRecord"), ("StakeholderInvolvementPage", "StakeholderInvolvement"),
                   ("ChampionConstraintPage", "ChampionConstraint"), ("ClosureRecordPage", "ClosureRecord"), ("TransitionDecisionPage", "TransitionDecision"),
                   ("PerformanceAreaPage", "PerformanceArea"), ("PerformanceAreaLinkPage", "PerformanceAreaLink"), ("BauHandoverPage", "BauHandover"),
                   ("ControlPage", "Control"), ("ControlCheckPage", "ControlCheck"), ("SustainmentReviewPage", "SustainmentReview"),
                   ("ImprovementItemPage", "ImprovementItem"), ("LessonPage", "Lesson"), ("LessonSearchPage", "LessonSearchHit")]:
    add(page(name, item))
SCHEMAS = "".join(SCH)

TAGS = """  - name: stakeholder-groups
    description: T13 Stakeholder & Adoption Plan, stakeholder groups, champions, involvement in design and champion constraints (P4, ADR-0033).
  - name: adoption-interventions
    description: Adoption interventions; one corrective intervention per indicator, scope and period below trajectory (P4, ADR-0033).
  - name: adoption-indicators
    description: The seven leading adoption indicators as KPI templates, metric links and indicator values (P4, ADR-0033).
  - name: assessment-forms
    description: Short native feedback and assessment forms (validated, versioned form JSON) and invitations (P4, ADR-0033).
  - name: assessment-records
    description: Feedback and proficiency observations, and training records; completion is never adoption (P4, ADR-0033).
  - name: status-model
    description: Separate delivery, adoption, validated-value and closure statuses (P4, ADR-0034).
  - name: closure
    description: Governed closure of initiatives and transformations; G6 approval alone closes nothing (P4, ADR-0034).
  - name: transition-decisions
    description: Benefit transition decisions with residual ownership and monitoring; forecast stays forecast (P4, ADR-0034).
  - name: performance-areas
    description: Performance areas that continue after transformation closure, with cycle history on reopening (P4, ADR-0034).
  - name: bau-handovers
    description: BAU handovers with the M0217 content and receiving-owner acceptance (P4, ADR-0034).
  - name: controls
    description: BAU controls and their check cadence (P4, ADR-0034).
  - name: control-checks
    description: Periodic control checks and recurring sustainment reviews (P4, ADR-0034).
  - name: improvement-items
    description: The continuous-improvement backlog; persists after closure (P4, ADR-0034).
  - name: lessons
    description: Lessons, searchable across transformations (P4, ADR-0034).
"""

INFO_ADD = """
    **P4 additions, slices F and G (T-DG4-ARCH-06, ADR-0033, ADR-0034).** Additive within v1: new paths, schemas and
    tags. The seven adoption indicators are seeded verbatim; proficiency without observations is Unknown, never 0.
    Delivery, adoption, validated value and closure are separate statuses; a transformation closes only through the
    governed closure action after its G6 business approval, and its performance areas, KPI actuals, backlog and lessons
    continue. Accepting a BAU handover is the receiving owner's business decision; no job accepts or closes anything.
"""

PERMS = ["adoption.edit", "assessment_form.manage", "assessment.respond", "assessment.review", "proficiency.record", "champion_constraint.raise",
         "adoption_status.set", "initiative.complete_delivery", "initiative.close", "transformation.close", "performance_area.manage",
         "performance_area.reopen", "bau_handover.prepare", "bau_handover.accept", "control.manage", "control_check.record",
         "sustainment_review.complete", "improvement.edit", "lesson.edit", "lesson.search", "transition_decision.propose"]


def main(path):
    s = open(path, encoding="utf-8").read()
    assert "operationId: listStakeholderGroups" not in s, "already applied"
    assert "  version: 1.3.0-p4\n" in s
    for key in PARAMS:
        assert f"\n    {key}:\n" not in s, key
    for line in SCHEMAS.split("\n"):
        if line.startswith("    ") and not line.startswith("     ") and line.endswith(":"):
            assert f"\n{line}\n" not in s, line
    anchor = "    Recording a T16 Outcome is a person's business decision; an escalation never decides.\n"
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
    perm_anchor = "        - escalation_rule.configure\n    RoleCode:\n"
    assert s.count(perm_anchor) == 1
    s = s.replace(perm_anchor, "        - escalation_rule.configure\n" + "".join(f"        - {p}\n" for p in PERMS) + "    RoleCode:\n", 1)
    s = s.rstrip("\n") + "\n" + SCHEMAS
    open(path, "w", encoding="utf-8").write(s)
    print(f"added {len(OPS)} operations: " + ", ".join(o["id"] for o in OPS))


if __name__ == "__main__":
    main(sys.argv[1])
