#!/usr/bin/env python3
"""T-DG4-ARCH-07: generates the slice H OpenAPI additions (ADR-0035, ADR-0036) and inserts them into
docs/api/openapi.yaml. Provenance only: run once by the solution-architect; the YAML file is the contract.
The op()/render_paths()/render_params()/page() helpers are copied from the T-DG4-ARCH-06 generator.

  python3 docs/delivery/handbacks/DG4/T-DG4-ARCH-07-evidence/openapi-p4-arch07.py docs/api/openapi.yaml

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

# ======================================================================================= phases (ADR-0035 §1)
op("/api/v1/phases", "get", "listPhases", "phases",
   "The six phases in order with name, title, purpose and key outputs (B0021, verbatim) and the phase objective; Arabic labels carry arProvisional (REQ-PB-014; any signed-in user).",
   ok_schema="PhaseDefinitionList", not_found=False, **RD)
op(T + "/phases", "get", "getPhaseWorkspace", "phases",
   "The phase workspace: the current phase, and per phase its objective, gate status, steps with procedure, required evidence, owner (Unknown when unassigned), status and the review-queue count (REQ-S04-001) (transformation.read).",
   params=TP, ok_schema="PhaseWorkspace", **RD)
op(T + "/phase-steps", "get", "listPhaseSteps", "phases",
   "Phase steps of the transformation; status=in_review is the phase review queue. A step without a row is listed not_started with version 0 (transformation.read).",
   params=TP, query=["Cursor", "Limit", "PhaseQuery", "PhaseStepStatusQuery"], ok_schema="PhaseStepPage", **RD)
PS, PSP = T + "/phase-steps/{stepKey}", TP + ["StepKey"]
op(PS, "get", "getPhaseStep", "phases", "Read one phase step; ETag \\\"0\\\" when it has no row yet (transformation.read).",
   params=PSP, ok_schema="PhaseStep", etag=True, **RD)
op(PS, "patch", "updatePhaseStep", "phases",
   "Assign the step owner and/or start the step (not_started -> in_progress); If-Match \\\"0\\\" creates the row (phase_step.manage; TL, TO). 422 phase_step.invalid_transition.",
   params=PSP, body="PhaseStepUpdate", ok_schema="PhaseStep", etag=True, if_match=True)
op(PS + "/request-review", "post", "requestPhaseStepReview", "phases",
   "Evaluate the step's completion rule server-side and, when met, put the step in the review queue (phase_step.progress; the step owner). 403 phase_step.not_owner; 422 phase_step.completion_rule_unmet, owner_required, invalid_transition.",
   params=PSP, ok_schema="PhaseStep", etag=True, if_match=True)
op(PS + "/review", "post", "reviewPhaseStep", "phases",
   "Accept (re-evaluates the completion rule) or return the step with a note; the reviewer is neither the owner nor the requester (phase_step.review; SP, BO, FIN, TO). 400 phase_step.return_note_required; 403 phase_step.reviewer_is_owner; 422 phase_step.completion_rule_unmet, invalid_transition.",
   params=PSP, body="PhaseStepReview", ok_schema="PhaseStep", etag=True, if_match=True)
op(PS + "/evidence", "get", "listPhaseStepEvidence", "phases", "Evidence linked to the step, active and removed (transformation.read).",
   params=PSP, query=["Cursor", "Limit"], ok_schema="PhaseStepEvidencePage", **RD)
op(PS + "/evidence", "post", "linkPhaseStepEvidence", "phases",
   "Link an evidence item of the transformation to the step (phase_step.progress; the step owner). 409 phase_step_evidence.exists; 422 phase_step.complete.",
   params=PSP, body="PhaseStepEvidenceLink", ok="201", ok_desc="Created (active).", ok_schema="PhaseStepEvidence", etag=True, location=True, dup=True)
op(PS + "/evidence/{phaseStepEvidenceId}/remove", "post", "removePhaseStepEvidence", "phases",
   "Remove an evidence link; the row stays as history (phase_step.progress; the step owner). 422 phase_step.complete.",
   params=PSP + ["PhaseStepEvidenceId"], ok_schema="PhaseStepEvidence", etag=True, if_match=True)

# ======================================================================================= gate reviews (ADR-0035 §3)
GS, GSP = T + "/gates/{gateCode}/submissions/{submissionNo}", TP + ["GateCode", "SubmissionNo"]
op(GS + "/criteria", "get", "listGateSubmissionCriteria", "gates",
   "The gate criteria review table of one submission: per criterion the nine fields criterion, required evidence, completeness, reviewer, finding, open condition, risk, decision and rationale (latest review; 'not reviewed' when none), plus a covering exception (REQ-S04-009) (transformation.read).",
   params=GSP, ok_schema="GateCriterionRowList", **RD)
op(GS + "/criteria/{criterionKey}/reviews", "get", "listGateCriterionReviews", "gates", "Every review of one criterion of the submission, oldest first (transformation.read).",
   params=GSP + ["CriterionKey"], query=["Cursor", "Limit"], ok_schema="GateCriterionReviewPage", **RD)
op(GS + "/criteria/{criterionKey}/reviews", "post", "createGateCriterionReview", "gates",
   "Record a review of one criterion of the pending submission; the first review moves the gate from Submitted to Under Review (gate.review; SP, BO, FIN, TO; If-Match = the gate's ETag). 403 gate.reviewer_is_submitter; 422 gate.review_not_open, gate.review_condition_required.",
   params=GSP + ["CriterionKey"], body="GateCriterionReviewCreate", ok="201", ok_desc="Created.", ok_schema="GateCriterionReview", location=True, if_match=True)

# ======================================================================================= gate exceptions (ADR-0035 §4)
op(T + "/gate-exceptions", "get", "listGateExceptions", "gate-exceptions",
   "Gate exceptions (waivers) of the transformation with their coverage on today's business date (covering / expired / not decided) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "GateCodeQuery", "GateExceptionStatusQuery"], ok_schema="GateExceptionPage", **RD)
op(T + "/gate-exceptions", "post", "createGateException", "gate-exceptions",
   "Request an exception for one missing mandatory criterion with reason, scope, compensating action (and owner) and expiry; the gate approver gets a My Work item (gate_exception.request; TL). 400 when expiry or compensating action is missing; 409 gate_exception.already_pending; 422 gate_exception.criterion_not_mandatory, expiry_in_past.",
   params=TP, body="GateExceptionCreate", ok="201", ok_desc="Created (pending).", ok_schema="GateException", etag=True, location=True, dup=True)
GE, GEP = T + "/gate-exceptions/{gateExceptionId}", TP + ["GateExceptionId"]
op(GE, "get", "getGateException", "gate-exceptions", "Read one exception (transformation.read).", params=GEP, ok_schema="GateException", etag=True, **RD)
op(GE + "/decision", "post", "decideGateException", "gate-exceptions",
   "Accept or reject a pending exception as the gate's configured approver, never the requester (gate_exception.decide; SP, BO). 403 gate_exception.not_approver, requester_cannot_decide; 422 gate_exception.not_pending.",
   params=GEP, body="GateExceptionDecision", ok_schema="GateException", etag=True, if_match=True)
op(GE + "/withdraw", "post", "withdrawGateException", "gate-exceptions", "Withdraw a pending exception (gate_exception.request; the requester). 422 gate_exception.not_pending.",
   params=GEP, ok_schema="GateException", etag=True, if_match=True)
op(GE + "/revoke", "post", "revokeGateException", "gate-exceptions",
   "Revoke an accepted exception with a reason; the criterion is missing again from that moment (gate_exception.decide; the gate's configured approver). 400 gate_exception.revoke_reason_required; 422 gate_exception.not_accepted.",
   params=GEP, body="GateExceptionRevoke", ok_schema="GateException", etag=True, if_match=True)

# ======================================================================================= scale (ADR-0035 §5)
op(T + "/scale-scope", "get", "getScaleScope", "scale",
   "The scale scope and conditions of the latest approved G5 decision; approved = false and empty lists before G5 is approved (transformation.read).",
   params=TP, ok_schema="ScaleScope", **RD)
op(T + "/scale-transitions", "get", "listScaleTransitions", "scale", "Scale transitions of the transformation (transformation.read).",
   params=TP, query=["Cursor", "Limit"], ok_schema="ScaleTransitionPage", **RD)
op(T + "/scale-transitions", "post", "createScaleTransition", "scale",
   "Scale an initiative into a business unit; only inside the scope of an approved G5 decision (scale.transition; TL). 409 scale.already_scaled; 422 invalid-transition gate.g5_not_approved (names G5), scale.outside_approved_scope.",
   params=TP, body="ScaleTransitionCreate", ok="201", ok_desc="Created.", ok_schema="ScaleTransition", location=True, dup=True)

# ======================================================================================= risk dispositions (ADR-0035 §6)
op(T + "/risk-dispositions", "get", "listRiskDispositions", "risk-dispositions",
   "Proposed and decided dispositions of RAID risks, each with its approval status (transformation.read).",
   params=TP, query=["Cursor", "Limit", "RaidEntryIdQuery"], ok_schema="RiskDispositionPage", **RD)
op(T + "/risk-dispositions", "post", "createRiskDisposition", "risk-dispositions",
   "Propose a disposition of an open risk (accept, transfer, carry into BAU) with rationale and residual owner; requests its business approval (risk_disposition.propose; TL, BO, WL; decided with approval.decide). 422 risk_disposition.not_open_risk, routing.role_unmapped.",
   params=TP, body="RiskDispositionCreate", ok="201", ok_desc="Created (approval pending).", ok_schema="RiskDisposition", etag=True, location=True)
op(T + "/risk-dispositions/{riskDispositionId}", "get", "getRiskDisposition", "risk-dispositions", "Read one disposition with its approval (transformation.read).",
   params=TP + ["RiskDispositionId"], ok_schema="RiskDisposition", etag=True, **RD)

# ======================================================================================= change control (ADR-0036)
op(T + "/change-control-policy", "get", "getChangeControlPolicy", "change-requests",
   "The materiality thresholds; null thresholds mean every change is material (version 0 when none is configured) (transformation.read).",
   params=TP, ok_schema="ChangeControlPolicy", etag=True, not_found=True, **RD)
op(T + "/change-control-policy", "put", "putChangeControlPolicy", "change-requests",
   "Set the materiality thresholds (working days; decimal ratio); If-Match \\\"0\\\" creates the row (change_control.configure; TL, TO). 422 change_control.threshold_invalid.",
   params=TP, body="ChangeControlPolicyUpdate", ok_schema="ChangeControlPolicy", etag=True, if_match=True)
op(T + "/change-requests", "get", "listChangeRequests", "change-requests", "Change requests of the transformation (transformation.read).",
   params=TP, query=["Cursor", "Limit", "ChangeRequestStatusQuery", "ChangeKindQuery"], ok_schema="ChangeRequestPage", **RD)
op(T + "/change-requests", "post", "createChangeRequest", "change-requests",
   "Raise a change request (draft) to an approved record with reason and proposed change (change_request.raise; TL, BO, WL, FIN, TO, KDS). 400 change_request.reason_required; 409 change_request.already_open; 422 change_request.kind_subject_mismatch, subject_not_approved, proposed_change_invalid, retrospective_not_supported.",
   params=TP, body="ChangeRequestCreate", ok="201", ok_desc="Created (draft).", ok_schema="ChangeRequest", etag=True, location=True, dup=True)
op(T + "/change-requests/impact-preview", "post", "previewChangeImpact", "change-requests",
   "Impact preview of an unsaved change: affected outcomes, KPIs, benefits, gates (naming the preserved approval), reports (T10 areas) and formulas; writes nothing (transformation.read).",
   params=TP, body="ChangeRequestCreate", ok_schema="ImpactPreview")
CR, CRP = T + "/change-requests/{changeRequestId}", TP + ["ChangeRequestId"]
op(CR, "get", "getChangeRequest", "change-requests", "Read one change request with its approval and current impact assessment (transformation.read).",
   params=CRP, ok_schema="ChangeRequest", etag=True, **RD)
op(CR, "patch", "updateChangeRequest", "change-requests",
   "Edit a draft or returned change request (change_request.raise; the requester, TL or TO). 403 change_request.not_requester; 422 change_request.not_editable, proposed_change_invalid.",
   params=CRP, body="ChangeRequestUpdate", ok_schema="ChangeRequest", etag=True, if_match=True)
op(CR + "/submit", "post", "submitChangeRequest", "change-requests",
   "Submit: compute materiality, freeze the impact assessment of this version and request the business approval routed per T11 (change_request.raise; the requester, TL or TO). 422 change_request.not_submittable, routing.role_unmapped.",
   params=CRP, ok_schema="ChangeRequest", etag=True, if_match=True)
op(CR + "/withdraw", "post", "withdrawChangeRequest", "change-requests",
   "Withdraw a change request that is not decided; its approval is withdrawn too (change_request.raise; the requester, TL or TO). 422 change_request.not_withdrawable.",
   params=CRP, ok_schema="ChangeRequest", etag=True, if_match=True)
op(CR + "/impact-preview", "get", "getChangeRequestImpactPreview", "change-requests", "Live impact preview of the request's current content (transformation.read).",
   params=CRP, ok_schema="ImpactPreview", **RD)
op(CR + "/impact-assessments", "get", "listImpactAssessments", "change-requests", "The frozen impact assessments of the request, one per submitted version (transformation.read).",
   params=CRP, query=["Cursor", "Limit"], ok_schema="ImpactAssessmentPage", **RD)
op(T + "/impact-assessments/{impactAssessmentId}", "get", "getImpactAssessment", "change-requests",
   "One frozen impact assessment with its items and content SHA-256 (transformation.read).",
   params=TP + ["ImpactAssessmentId"], ok_schema="ImpactAssessment", **RD)

def enum(*v): return "{ type: string, enum: [%s] }" % ", ".join(v)
STEP_KEY = "{ type: string, pattern: '^(diagnose|define|design|mobilize|transform|realize)\\\\.[a-z_]{1,48}$' }"
CRIT_KEY = "{ type: string, pattern: '^g[1-6]\\\\.[a-z_]{1,48}$' }"
PARAMS = {
    "StepKey": ("stepKey", "path", STEP_KEY),
    "PhaseStepEvidenceId": ("phaseStepEvidenceId", "path", UUID),
    "CriterionKey": ("criterionKey", "path", CRIT_KEY),
    "GateExceptionId": ("gateExceptionId", "path", UUID),
    "RiskDispositionId": ("riskDispositionId", "path", UUID),
    "ChangeRequestId": ("changeRequestId", "path", UUID),
    "ImpactAssessmentId": ("impactAssessmentId", "path", UUID),
    "PhaseQuery": ("phase", "query", '{ $ref: "#/components/schemas/Phase" }'),
    "PhaseStepStatusQuery": ("status", "query", enum("not_started", "in_progress", "in_review", "complete", "returned")),
    "GateCodeQuery": ("gateCode", "query", "{ type: string, pattern: '^G[1-6]$' }"),
    "GateExceptionStatusQuery": ("status", "query", enum("pending", "accepted", "rejected", "withdrawn", "revoked")),
    "RaidEntryIdQuery": ("raidEntryId", "query", UUID),
    "ChangeRequestStatusQuery": ("status", "query", enum("draft", "submitted", "changes_requested", "approved", "rejected", "withdrawn")),
    "ChangeKindQuery": ("kind", "query", '{ $ref: "#/components/schemas/ChangeKind" }'),
}

U = '{ $ref: "#/components/schemas/Uuid" }'
NU = '{ $ref: "#/components/schemas/NullableUuid" }'
TS = '{ $ref: "#/components/schemas/Timestamp" }'
NTS = '{ $ref: "#/components/schemas/NullableTimestamp" }'
BD = '{ $ref: "#/components/schemas/BusinessDate" }'
NBD = '{ $ref: "#/components/schemas/NullableBusinessDate" }'
V = '{ $ref: "#/components/schemas/Version" }'
ND = '{ $ref: "#/components/schemas/NullableDecimal" }'
PH = '{ $ref: "#/components/schemas/Phase" }'
def S(n, a=1, b=2000): return "{ type: string, minLength: %d, maxLength: %d }" % (a, b)
def NS(n=None, a=1, b=2000): return '{ type: [string, "null"], minLength: %d, maxLength: %d }' % (a, b)
def EN(*v, null=False):
    if null: return '{ type: [string, "null"], enum: [%s, null] }' % ", ".join(v)
    return "{ type: string, enum: [%s] }" % ", ".join(v)
GC = "{ type: string, pattern: '^G[1-6]$' }"
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
def lst(name, item): return obj(name, "", [("items", arr(ref(item)))])

SC = ""
# --- phases
SC += obj("PhaseDefinition", "One of the six phases; source* text is verbatim from the playbook (B0021 and the phase blocks); Arabic is provisional when arProvisional.", [
    ("code", PH), ("ordinal", "{ type: integer, minimum: 1, maximum: 6 }"), ("gateCode", GC), ("sourceNameEn", S(0, 1, 50)), ("nameAr", S(0, 1, 100)),
    ("sourceTitleEn", S(0, 1, 200)), ("titleAr", S(0, 1, 200)), ("sourcePurposeEn", S(0, 1, 200)), ("purposeAr", S(0, 1, 200)),
    ("sourceKeyOutputsEn", S(0, 1, 500)), ("keyOutputsAr", S(0, 1, 500)), ("sourceObjectiveEn", S(0, 1, 1000)), ("objectiveAr", S(0, 1, 1000)),
    ("sourceRef", S(0, 1, 100)), ("arProvisional", "{ type: boolean }")])
SC += obj("PhaseDefinitionList", "", [("items", arr(ref("PhaseDefinition"), 6, 6))])
SC += obj("PhaseStep", "A step of a phase in one transformation. A step with no row has version 0, status not_started and a null owner (shown Unknown).", [
    ("transformationId", U), ("stepKey", STEP_KEY), ("phase", PH), ("ordinal", "{ type: integer, minimum: 1, maximum: 10 }"),
    ("sourceProcedureEn", S(0, 1, 500)), ("procedureAr", S(0, 1, 500)), ("requiredEvidenceEn", S(0, 1, 500)), ("requiredEvidenceAr", S(0, 1, 500)),
    ("defaultOwnerRoleCode", S(0, 1, 32)), ("reviewerRoleCode", S(0, 1, 32)),
    ("completionRule", EN("evidence_linked", "meeting_held", "kpi_actual_accepted", "raid_register_present", "benefit_validated", "corrective_cases_owned", "handover_accepted", "improvement_backlog_present")),
    ("id", NU), ("ownerUserId", NU), ("status", EN("not_started", "in_progress", "in_review", "complete", "returned")),
    ("enabledByGateDecisionId", NU), ("reviewRequestedBy", NU), ("reviewRequestedAt", NTS),
    ("completionCheck", '{ type: ["object", "null"], description: "Frozen at review request: rule, met, facts." }'),
    ("reviewedBy", NU), ("reviewedAt", NTS), ("reviewOutcome", EN("accepted", "returned", null=True)), ("reviewNote", NS(b=2000)), ("completedAt", NTS),
    ("version", "{ type: integer, minimum: 0 }")])
SC += obj("PhaseStepPage", "", [("items", arr(ref("PhaseStep"))), ("nextCursor", '{ type: [string, "null"] }')])
SC += obj("PhaseWorkspacePhase", "", [("phase", ref("PhaseDefinition")), ("isCurrent", "{ type: boolean }"),
    ("gateStatus", EN("draft", "submitted", "under_review", "changes_requested", "approved", "rejected", "deferred")),
    ("steps", arr(ref("PhaseStep"))), ("reviewQueueCount", "{ type: integer, minimum: 0 }")])
SC += obj("PhaseWorkspace", "Guided phase workspace (REQ-S04-001); gate statuses are product G1-G6 business approvals, never DG0-DG7.", [
    ("transformationId", U), ("currentPhase", PH), ("phases", arr(ref("PhaseWorkspacePhase"), 6, 6))])
SC += obj("PhaseStepUpdate", "At least one member.", [("ownerUserId", U), ("start", "{ type: boolean, const: true }")], required=[], extra="      minProperties: 1")
SC += obj("PhaseStepReview", "", [("outcome", EN("accepted", "returned")), ("note", S(0, 1, 2000))], required=["outcome"])
SC += obj("PhaseStepEvidence", "", [("id", U), ("transformationId", U), ("phaseStepId", U), ("evidenceId", U), ("status", EN("active", "removed")),
    ("removedBy", NU), ("removedAt", NTS)] + STAMPS)
SC += obj("PhaseStepEvidencePage", "", [("items", arr(ref("PhaseStepEvidence"))), ("nextCursor", '{ type: [string, "null"] }')])
SC += obj("PhaseStepEvidenceLink", "", [("evidenceId", U)])
# --- gate reviews
SC += obj("GateCriterionReview", "One review of one criterion of a pending submission (append-only).", [
    ("id", U), ("gateSubmissionId", U), ("criterionKey", CRIT_KEY), ("reviewNo", "{ type: integer, minimum: 1 }"), ("reviewerUserId", U),
    ("finding", S(0, 1, 4000)), ("openCondition", NS(b=2000)), ("riskNote", NS(b=2000)), ("raidEntryId", NU),
    ("recommendation", EN("meets", "meets_with_conditions", "does_not_meet")), ("rationale", S(0, 3, 4000)), ("reviewedAt", TS)])
SC += obj("GateCriterionReviewPage", "", [("items", arr(ref("GateCriterionReview"))), ("nextCursor", '{ type: [string, "null"] }')])
SC += obj("GateCriterionReviewCreate", "openCondition is required when recommendation = meets_with_conditions (422).", [
    ("finding", S(0, 1, 4000)), ("openCondition", S(0, 1, 2000)), ("riskNote", S(0, 1, 2000)), ("raidEntryId", U),
    ("recommendation", EN("meets", "meets_with_conditions", "does_not_meet")), ("rationale", S(0, 3, 4000))], required=["finding", "recommendation", "rationale"])
SC += obj("GateCriterionRow", "The nine M0124 fields of one criterion row; the six review fields are null (shown 'not reviewed') until a review exists.", [
    ("criterionKey", CRIT_KEY), ("ordinal", "{ type: integer, minimum: 1 }"), ("mandatory", "{ type: boolean }"),
    ("criterionLabelEn", S(0, 1, 200)), ("criterionLabelAr", S(0, 1, 200)), ("requiredEvidenceEn", S(0, 1, 1000)), ("requiredEvidenceAr", S(0, 1, 1000)),
    ("completeness", EN("complete", "incomplete")), ("reviewerUserId", NU), ("finding", NS(b=4000)), ("openCondition", NS(b=2000)),
    ("risk", '{ type: ["object", "null"], additionalProperties: false, required: [note, raidEntryId], properties: { note: { type: [string, "null"] }, raidEntryId: { $ref: "#/components/schemas/NullableUuid" } } }'),
    ("decision", EN("meets", "meets_with_conditions", "does_not_meet", null=True)), ("rationale", NS(b=4000)), ("reviewCount", "{ type: integer, minimum: 0 }"),
    ("exception", '{ oneOf: [{ $ref: "#/components/schemas/GateException" }, { type: "null" }] }')])
SC += obj("GateCriterionRowList", "", [("gateCode", GC), ("submissionNo", "{ type: integer, minimum: 1 }"), ("snapshotSha256", "{ type: string, pattern: '^[0-9a-f]{64}$' }"),
    ("gateStatus", EN("draft", "submitted", "under_review", "changes_requested", "approved", "rejected", "deferred")), ("items", arr(ref("GateCriterionRow")))])
# --- gate exceptions
SC += obj("GateException", "A specifically authorized exception (waiver) for one mandatory criterion (REQ-S04-012/013). covering is computed for today's business date.", [
    ("id", U), ("transformationId", U), ("gateInstanceId", U), ("gateCode", GC), ("criterionKey", CRIT_KEY), ("reason", S(0, 3, 4000)), ("scope", S(0, 3, 2000)),
    ("compensatingAction", S(0, 3, 4000)), ("compensatingOwnerUserId", U), ("expiresOn", BD),
    ("status", EN("pending", "accepted", "rejected", "withdrawn", "revoked")), ("covering", "{ type: boolean }"),
    ("requestedBy", U), ("requestedAt", TS), ("decidedBy", NU), ("decidedOnBehalfOf", NU), ("decidedAt", NTS), ("decisionNote", NS(b=2000)),
    ("revokedBy", NU), ("revokedAt", NTS), ("revokeReason", NS(b=1000)), ("expiryNotifiedAt", NTS)] + STAMPS)
SC += obj("GateExceptionPage", "", [("items", arr(ref("GateException"))), ("nextCursor", '{ type: [string, "null"] }')])
SC += obj("GateExceptionCreate", "All five REQ-S04-013 fields are required: a missing expiry or compensating action is 400.", [
    ("gateCode", GC), ("criterionKey", CRIT_KEY), ("reason", S(0, 3, 4000)), ("scope", S(0, 3, 2000)), ("compensatingAction", S(0, 3, 4000)),
    ("compensatingOwnerUserId", U), ("expiresOn", BD)])
SC += obj("GateExceptionDecision", "", [("outcome", EN("accepted", "rejected")), ("note", S(0, 3, 2000)), ("onBehalfOfUserId", U)], required=["outcome", "note"])
SC += obj("GateExceptionRevoke", "", [("reason", S(0, 3, 1000))])
# --- scale
SC += obj("ScaleScopeItemCreate", "", [("initiativeId", U), ("businessUnitId", U), ("note", S(0, 1, 1000))], required=["initiativeId", "businessUnitId"])
SC += obj("GateConditionCreate", "", [("text", S(0, 3, 2000)), ("ownerUserId", U), ("dueDate", BD)])
SC += obj("GateScaleScope", "G5 only (D-089 seam 2): the approved scale scope; every item names one initiative and one business unit, so a scope is never unrestricted (M0124). Required with a G5 approval (422 gate.scale_scope_required); any other gate or outcome: 422 gate.scale_scope_not_applicable.", [
    ("items", arr(ref("ScaleScopeItemCreate"), 1, 100)), ("conditions", arr(ref("GateConditionCreate"), 0, 20))], required=["items"])
SC += obj("ScaleScopeItem", "", [("id", U), ("initiativeId", U), ("businessUnitId", U), ("note", NS(b=1000))])
SC += obj("GateCondition", "", [("id", U), ("ordinal", "{ type: integer, minimum: 1, maximum: 20 }"), ("text", S(0, 3, 2000)), ("ownerUserId", U), ("dueDate", BD)])
SC += obj("ScaleScope", "", [("approved", "{ type: boolean }"), ("gateDecisionId", NU), ("decidedAt", NTS), ("items", arr(ref("ScaleScopeItem"))), ("conditions", arr(ref("GateCondition")))])
SC += obj("ScaleTransition", "", [("id", U), ("transformationId", U), ("initiativeId", U), ("businessUnitId", U), ("gateDecisionId", U), ("note", NS(b=2000)),
    ("transitionedBy", U), ("transitionedAt", TS)])
SC += obj("ScaleTransitionPage", "", [("items", arr(ref("ScaleTransition"))), ("nextCursor", '{ type: [string, "null"] }')])
SC += obj("ScaleTransitionCreate", "", [("initiativeId", U), ("businessUnitId", U), ("note", S(0, 1, 2000))], required=["initiativeId", "businessUnitId"])
# --- risk dispositions
SC += obj("RiskDisposition", "approvalStatus is the status of its canonical approval (type risk_disposition); approved counts for G5 Risk closure.", [
    ("id", U), ("transformationId", U), ("raidEntryId", U), ("disposition", EN("accept", "transfer", "carry_into_bau")), ("rationale", S(0, 3, 4000)),
    ("residualOwnerUserId", U), ("approvalId", NU), ("approvalStatus", EN("pending", "changes_requested", "deferred", "approved", "rejected", "withdrawn", null=True)),
    ("version", V), ("createdAt", TS), ("createdBy", U)])
SC += obj("RiskDispositionPage", "", [("items", arr(ref("RiskDisposition"))), ("nextCursor", '{ type: [string, "null"] }')])
SC += obj("RiskDispositionCreate", "", [("raidEntryId", U), ("disposition", EN("accept", "transfer", "carry_into_bau")), ("rationale", S(0, 3, 4000)), ("residualOwnerUserId", U)])
# --- change control
SC += "    ChangeKind:\n      type: string\n      enum: [business_scope, baseline, target, tom, cost, benefit_logic, kpi_definition, schedule_rebaseline, budget_rebaseline]\n"
SC += obj("ChangeControlPolicy", "Null thresholds mean every change of that kind is material; version 0 when none is configured.", [
    ("transformationId", U), ("materialDateShiftWorkingDays", '{ type: ["integer", "null"], minimum: 0, maximum: 250 }'),
    ("materialBudgetChangeRatio", ND), ("note", NS(b=2000)), ("version", "{ type: integer, minimum: 0 }"), ("updatedAt", NTS), ("updatedBy", NU)])
SC += obj("ChangeControlPolicyUpdate", "materialBudgetChangeRatio is a decimal string fraction (0.05 = 5 %), 0 to 10.", [
    ("materialDateShiftWorkingDays", '{ type: ["integer", "null"], minimum: 0, maximum: 250 }'), ("materialBudgetChangeRatio", ND), ("note", NS(b=2000))],
    required=["materialDateShiftWorkingDays", "materialBudgetChangeRatio"])
SUBJ = EN("charter", "kpi_definition", "outcome_kpi", "tom_canvas_cell", "initiative", "benefit_formula", "milestone", "budget_line")
SC += obj("ChangeRequestCreate", "proposedChange holds { field: { from, to } } validated per kind (ADR-0036 §2); decimals are strings.", [
    ("changeKind", ref("ChangeKind")), ("subjectType", SUBJ), ("subjectId", U), ("subjectVersion", "{ type: integer, minimum: 1 }"),
    ("proposedRecordType", EN("kpi_version", "benefit_formula_version")), ("proposedRecordId", U),
    ("proposedChange", '{ type: object, minProperties: 1, maxProperties: 20 }'), ("reason", S(0, 3, 4000))],
    required=["changeKind", "subjectType", "subjectId", "subjectVersion", "proposedChange", "reason"])
SC += obj("ChangeRequestUpdate", "At least one member.", [("proposedRecordId", U), ("proposedChange", '{ type: object, minProperties: 1, maxProperties: 20 }'),
    ("reason", S(0, 3, 4000)), ("subjectVersion", "{ type: integer, minimum: 1 }")], required=[], extra="      minProperties: 1")
SC += obj("ChangeRequest", "A change request to an approved record; its decision is the canonical approval (approvalId), so the original approval and snapshot stay unchanged.", [
    ("id", U), ("transformationId", U), ("code", "{ type: string, pattern: '^CR-[0-9]{2,}$' }"), ("changeKind", ref("ChangeKind")), ("subjectType", SUBJ), ("subjectId", U),
    ("subjectVersion", "{ type: integer, minimum: 1 }"), ("proposedRecordType", EN("kpi_version", "benefit_formula_version", null=True)), ("proposedRecordId", NU),
    ("proposedChange", "{ type: object }"), ("reason", S(0, 3, 4000)), ("origin", EN("manual", "automatic")),
    ("materiality", EN("material", "not_material", null=True)), ("materialityBasis", '{ type: ["object", "null"] }'),
    ("routePartyCode", '{ type: [string, "null"] }'), ("decisionRightId", NU), ("approvalId", NU),
    ("status", EN("draft", "submitted", "changes_requested", "approved", "rejected", "withdrawn")), ("raisedBy", U), ("submittedBy", NU), ("submittedAt", NTS),
    ("currentImpactAssessmentId", NU), ("decidedAt", NTS), ("appliedAt", NTS), ("appliedRecordType", '{ type: [string, "null"] }'), ("appliedRecordId", NU),
    ("appliedVersion", '{ type: ["integer", "null"], minimum: 1 }'), ("withdrawnAt", NTS)] + STAMPS)
SC += obj("ChangeRequestPage", "", [("items", arr(ref("ChangeRequest"))), ("nextCursor", '{ type: [string, "null"] }')])
SC += obj("ImpactItem", "One affected record; a gate item names the affected submission and, when approved, the preserved decision.", [
    ("ordinal", "{ type: integer, minimum: 1 }"),
    ("itemType", EN("outcome", "kpi", "benefit", "gate", "report", "formula", "initiative", "milestone", "business_case", "budget_line")),
    ("recordType", '{ type: [string, "null"] }'), ("recordId", NU), ("recordCode", NS(b=50)), ("label", S(0, 1, 300)),
    ("effect", EN("value_changes", "recalculation", "reapproval_required", "informational")), ("gateSubmissionId", NU), ("gateDecisionId", NU), ("detail", "{ type: object }")])
SC += obj("ImpactPreview", "Computed, not stored. hiddenItemCount counts affected records outside the caller's scope (never shown as 'no impact').", [
    ("materiality", EN("material", "not_material")), ("materialityBasis", "{ type: object }"), ("items", arr(ref("ImpactItem"))), ("hiddenItemCount", "{ type: integer, minimum: 0 }")])
SC += obj("ImpactAssessment", "Frozen at submit for one change-request version (append-only).", [
    ("id", U), ("transformationId", U), ("changeRequestId", U), ("changeRequestVersion", "{ type: integer, minimum: 1 }"), ("itemCount", "{ type: integer, minimum: 0 }"),
    ("contentSha256", "{ type: string, pattern: '^[0-9a-f]{64}$' }"), ("assessedAt", TS), ("assessedBy", U), ("items", arr(ref("ImpactItem")))])
SC += obj("ImpactAssessmentPage", "", [("items", arr(ref("ImpactAssessment"))), ("nextCursor", '{ type: [string, "null"] }')])
SCHEMAS = SC

TAGS = """  - name: phases
    description: The six phases (B0021) and their guided steps, owners, completion rules and review queue (P4, ADR-0035).
  - name: gate-exceptions
    description: Specifically authorized exceptions (waivers) for missing mandatory gate evidence, with reason, scope, approver, expiry and compensating action (P4, ADR-0035).
  - name: scale
    description: The approved G5 scale scope and scale transitions; scaling outside the approved scope is refused (P4, ADR-0035).
  - name: risk-dispositions
    description: Approved dispositions of material risks for G5 Risk closure (P4, ADR-0035).
  - name: change-requests
    description: Change control for approved records with impact assessment and reapproval; original approvals and snapshots are preserved (P4, ADR-0036).
"""

INFO_ADD = """
    **P4 additions, slice H (T-DG4-ARCH-07, ADR-0035, ADR-0036).** Additive within v1 except the D-089-accepted
    `GateDecisionCreate.scaleScope` member (G5 only). G5 Scale and G6 Sustain use the existing gate paths; a mandatory
    criterion may be submitted incomplete only when an accepted, unexpired exception covers it, and the snapshot records
    it. Change requests are decided through the canonical approval; approving a change never edits an earlier approval
    or evidence snapshot. Product gate G6 never implies the engineering gate DG7.
"""

PERMS = ["phase_step.manage", "phase_step.progress", "phase_step.review", "gate.review", "gate_exception.request", "gate_exception.decide",
         "scale.transition", "risk_disposition.propose", "change_request.raise", "change_control.configure"]

SCALE_MEMBER = '        agreements: { $ref: "#/components/schemas/GateAgreements" }\n    EvidenceReview:\n'
SCALE_NEW = '        agreements: { $ref: "#/components/schemas/GateAgreements" }\n        scaleScope: { $ref: "#/components/schemas/GateScaleScope" }\n    EvidenceReview:\n'


def main(path):
    s = open(path, encoding="utf-8").read()
    assert "operationId: listPhases" not in s, "already applied"
    assert "  version: 1.3.0-p4\n" in s
    for key in PARAMS:
        assert f"\n    {key}:\n" not in s, key
    for line in SCHEMAS.split("\n"):
        if line.startswith("    ") and not line.startswith("     ") and line.endswith(":"):
            assert f"\n{line}\n" not in s, line
    anchor = "    continue. Accepting a BAU handover is the receiving owner's business decision; no job accepts or closes anything.\n"
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
    perm_anchor = "        - transition_decision.propose\n    RoleCode:\n"
    assert s.count(perm_anchor) == 1
    s = s.replace(perm_anchor, "        - transition_decision.propose\n" + "".join(f"        - {p}\n" for p in PERMS) + "    RoleCode:\n", 1)
    assert s.count(SCALE_MEMBER) == 1
    s = s.replace(SCALE_MEMBER, SCALE_NEW, 1)
    s = s.rstrip("\n") + "\n" + SCHEMAS
    open(path, "w", encoding="utf-8").write(s)
    print(f"added {len(OPS)} operations: " + ", ".join(o["id"] for o in OPS))


if __name__ == "__main__":
    main(sys.argv[1])
