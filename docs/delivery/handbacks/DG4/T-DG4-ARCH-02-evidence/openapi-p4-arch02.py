#!/usr/bin/env python3
"""T-DG4-ARCH-02: generates the slice A OpenAPI additions (ADR-0027, ADR-0028) and inserts them into
docs/api/openapi.yaml. Provenance only: run once by the solution-architect; the YAML file is the contract.

  python3 docs/delivery/handbacks/DG4/T-DG4-ARCH-02-evidence/openapi-p4-arch02.py docs/api/openapi.yaml

Every operation declares the ADR-0007 §5b statuses: 400, 401 (non-public), 403 (when it needs a permission or a
record-level right), 404 (path ids), 409/428 (If-Match), 422 (business rules) and 429; problem+json errors;
ETag on single-resource responses; Cursor/Limit on paginated lists.
"""
import sys

R = lambda name: '{ $ref: "#/components/responses/%s" }' % name  # noqa: E731

OPS = []  # (path, path_params, method, op)


def op(path, method, op_id, tag, summary, *, params=(), query=(), body=None, ok="200", ok_desc="OK.", ok_schema=None,
       etag=False, location=False, if_match=False, forbidden=True, not_found=True, rule=True, dup=False, public_read=False):
    OPS.append(dict(path=path, method=method, id=op_id, tag=tag, summary=summary, params=params, query=query, body=body,
                    ok=ok, ok_desc=ok_desc, ok_schema=ok_schema, etag=etag, location=location, if_match=if_match,
                    forbidden=forbidden, not_found=not_found, rule=rule, dup=dup))



T = "/api/v1/transformations/{transformationId}"
KD = T + "/kpi-definitions/{kpiDefinitionId}"
TP = ["TransformationId"]
KP = ["TransformationId", "KpiDefinitionId"]

# ----------------------------------------------------------------------------------------------- KPI versions (ADR-0027 §1-§4)
op(T + "/kpi-dictionary", "get", "listKpiDictionary", "kpi-versions",
   "The KPI dictionary v2 (REQ-S07-001): each KPI definition with its active version (null = no P4 version in force; P4 values then show Unknown) and the id of its draft, plus the fields still missing before P4 use (transformation.read).",
   params=TP, query=["Cursor", "Limit"], ok_schema="KpiDictionaryPage", forbidden=False, rule=False)
op(KD + "/dictionary-entry", "get", "getKpiDictionaryEntry", "kpi-versions",
   "One dictionary entry: the DG2 definition and its active and draft versions, together holding every REQ-S07-001 field (transformation.read).",
   params=KP, ok_schema="KpiDictionaryEntry", forbidden=False, rule=False)
op(KD + "/versions", "get", "listKpiVersions", "kpi-versions", "Versions of a KPI, newest first (transformation.read).",
   params=KP, query=["Cursor", "Limit"], ok_schema="KpiVersionPage", forbidden=False, rule=False)
op(KD + "/versions", "post", "createKpiVersion", "kpi-versions",
   "Create the draft version (kpi_version.edit; TL, KDS). Unit, currency and frequency come from the definition. 409 kpi_version.draft_exists; 422 kpi_version.measure_mismatch, kpi_version.aggregation_not_allowed, kpi_version.custom_formula_needs_approval, kpi_version.band_required, kpi_version.reviewer_required, kpi_version.change_reason_required, kpi_formula.circular, kpi_formula.unit_mismatch, kpi_formula.input_unknown_kpi, formula.* (ADR-0024 §6).",
   params=KP, body="KpiVersionCreate", ok="201", ok_desc="Created (draft).", ok_schema="KpiVersion", etag=True, location=True, dup=True)
op(T + "/kpi-versions/{kpiVersionId}", "get", "getKpiVersion", "kpi-versions", "Read one KPI version with its formula inputs (transformation.read).",
   params=["TransformationId", "KpiVersionId"], ok_schema="KpiVersion", etag=True, forbidden=False, rule=False)
op(T + "/kpi-versions/{kpiVersionId}", "patch", "updateKpiVersion", "kpi-versions",
   "Change a draft version (kpi_version.edit). Formula inputs are fixed at creation: a different formula is a new draft. 422 kpi_version.not_draft and the createKpiVersion rules.",
   params=["TransformationId", "KpiVersionId"], body="KpiVersionUpdate", ok_schema="KpiVersion", etag=True, if_match=True)
op(T + "/kpi-versions/{kpiVersionId}/activate", "post", "activateKpiVersion", "kpi-versions",
   "Activate a draft; the previous active version becomes superseded (kpi_version.activate; TL, KDS). 422 kpi_version.aggregation_rule_required (D-089 Q1), kpi_version.ratio_labels_required, kpi_version.milestone_due_date_required, kpi_version.definition_not_active, kpi_version.approval_required, kpi_formula.circular, kpi_version.not_draft.",
   params=["TransformationId", "KpiVersionId"], ok_schema="KpiVersion", etag=True, if_match=True)
op(T + "/kpi-versions/{kpiVersionId}/withdraw", "post", "withdrawKpiVersion", "kpi-versions",
   "Withdraw a draft with a reason (kpi_version.edit). Final. 422 kpi_version.not_draft.",
   params=["TransformationId", "KpiVersionId"], body="ReasonRequest", ok_schema="KpiVersion", etag=True, if_match=True)
op(T + "/kpi-versions/{kpiVersionId}/approval-requests", "post", "requestKpiVersionApproval", "kpi-versions",
   "Request the business approval of a draft whose definitionApproval is business_approval (kpi_version.activate). Routed to the Business Owner through the approval engine (ADR-0026 §4); the version is frozen while the approval is open. 409 approval.already_open; 422 kpi_version.not_draft, routing.role_unmapped.",
   params=["TransformationId", "KpiVersionId"], body="KpiVersionApprovalRequest", ok="201", ok_desc="Approval requested (pending).", ok_schema="Approval",
   etag=True, location=True, if_match=True)
op(KD + "/rag-thresholds", "get", "listKpiRagThresholds", "kpi-versions", "RAG threshold versions of a KPI, newest first; the active one is in force (transformation.read).",
   params=KP, query=["Cursor", "Limit"], ok_schema="KpiRagThresholdPage", forbidden=False, rule=False)
op(KD + "/rag-thresholds", "post", "createKpiRagThreshold", "kpi-versions",
   "Set the next threshold version; the previous one is superseded and the KPI's current-period RAG is recomputed by one calculation run (kpi_threshold.configure; TL, KDS; REQ-S07-007). 422 kpi_threshold.order.",
   params=KP, body="KpiRagThresholdCreate", ok="201", ok_desc="Created (active).", ok_schema="KpiRagThreshold", etag=True, location=True)

# ----------------------------------------------------------------------------------------------- reporting periods (ADR-0027 §3)
O = "/api/v1/organizations/{organizationId}/reporting-periods"
op(O, "get", "listReportingPeriods", "reporting-periods", "Reporting periods of the organization, latest first (organization.read).",
   params=["OrganizationId"], query=["Cursor", "Limit", "FrequencyQuery", "ReportingPeriodStatusQuery"], ok_schema="ReportingPeriodPage", forbidden=False, rule=False)
op(O, "post", "createReportingPeriod", "reporting-periods",
   "Create a scheduled period (reporting_period.manage; TO). 409 reporting_period.label_taken; 422 reporting_period.overlap, reporting_period.weeks_invalid, reporting_period.range_invalid.",
   params=["OrganizationId"], body="ReportingPeriodCreate", ok="201", ok_desc="Created (scheduled).", ok_schema="ReportingPeriod", etag=True, location=True, dup=True)
op(O + "/{reportingPeriodId}", "get", "getReportingPeriod", "reporting-periods", "Read one reporting period (organization.read).",
   params=["OrganizationId", "ReportingPeriodId"], ok_schema="ReportingPeriod", etag=True, forbidden=False, rule=False)
op(O + "/{reportingPeriodId}/open", "post", "openReportingPeriod", "reporting-periods",
   "Open a scheduled period for reporting before the job does (reporting_period.manage). 422 reporting_period.status_step.",
   params=["OrganizationId", "ReportingPeriodId"], ok_schema="ReportingPeriod", etag=True, if_match=True)
op(O + "/{reportingPeriodId}/close", "post", "closeReportingPeriod", "reporting-periods",
   "Close an open period; it takes no new actual (reporting_period.manage). Final in P4. 422 reporting_period.status_step.",
   params=["OrganizationId", "ReportingPeriodId"], ok_schema="ReportingPeriod", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- target trajectories (ADR-0027 §5)
op(KD + "/trajectories", "get", "listTargetTrajectories", "target-trajectories", "Trajectory versions of a KPI, by scope (transformation.read).",
   params=KP, query=["Cursor", "Limit", "ScopeKindQuery", "ScopeIdQuery"], ok_schema="TargetTrajectoryPage", forbidden=False, rule=False)
op(KD + "/trajectories", "post", "createTargetTrajectory", "target-trajectories",
   "Create a draft trajectory with its points, or import the current points of a DG2 T02 row (sourceOutcomeKpiId) (target_trajectory.edit; TL, KDS). Points are fixed once created. 409 target_trajectory.draft_exists; 422 kpi.scope_invalid.",
   params=KP, body="TargetTrajectoryCreate", ok="201", ok_desc="Created (draft).", ok_schema="TargetTrajectory", etag=True, location=True, dup=True)
op(T + "/target-trajectories/{targetTrajectoryId}", "get", "getTargetTrajectory", "target-trajectories", "Read one trajectory with its points (transformation.read).",
   params=["TransformationId", "TargetTrajectoryId"], ok_schema="TargetTrajectory", etag=True, forbidden=False, rule=False)
op(T + "/target-trajectories/{targetTrajectoryId}/approve", "post", "approveTargetTrajectory", "target-trajectories",
   "Approve a draft trajectory (kpi_target.approve; SP, BO: a business approval). The previously approved one for the KPI and scope is superseded, and one calculation run re-evaluates RAG. 403 target_trajectory.approver_is_author; 422 target_trajectory.points_required, target_trajectory.not_draft.",
   params=["TransformationId", "TargetTrajectoryId"], body="TargetTrajectoryApproval", ok_schema="TargetTrajectory", etag=True, if_match=True)
op(T + "/target-trajectories/{targetTrajectoryId}/withdraw", "post", "withdrawTargetTrajectory", "target-trajectories",
   "Withdraw a draft with a reason (target_trajectory.edit). 422 target_trajectory.not_draft.",
   params=["TransformationId", "TargetTrajectoryId"], body="ReasonRequest", ok_schema="TargetTrajectory", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- KPI actuals (ADR-0027 §6, §8)
op(KD + "/actuals", "get", "listKpiActuals", "kpi-actuals", "Actual slots of a KPI (one per scope and reporting period), latest period first (transformation.read).",
   params=KP, query=["Cursor", "Limit", "ScopeKindQuery", "ScopeIdQuery", "ReportingPeriodIdQuery", "KpiActualStatusQuery"], ok_schema="KpiActualPage", forbidden=False, rule=False)
op(KD + "/actuals", "post", "submitKpiActual", "kpi-actuals",
   "The routine update (REQ-S07-017): the first value of a KPI, scope and period, with evidence, saved as a draft or submitted. On the review route a submitted value is not used until accepted; on the direct-accept route it is accepted at once and one calculation run follows (kpi_actual.submit; KDS, BO; the KPI's owner, steward or update assignee). The response lists the downstream views that change and whether review is pending. 409 when the slot exists (use addKpiActualValue); 403 kpi_actual.not_owner; 422 kpi_actual.no_active_version, kpi_actual.period_not_open, kpi_actual.period_frequency, kpi_actual.scope_kind, kpi_actual.currency_mismatch, kpi_actual.value_shape, kpi_actual.evidence_required, kpi.scope_invalid, routing.role_unmapped.",
   params=KP, body="KpiActualEntry", ok="201", ok_desc="Created.", ok_schema="KpiActualSubmission", etag=True, location=True, dup=True)
op(T + "/kpi-actuals/{kpiActualId}", "get", "getKpiActual", "kpi-actuals", "Read one slot with every value version, review and evidence link (transformation.read).",
   params=["TransformationId", "KpiActualId"], ok_schema="KpiActual", etag=True, forbidden=False, rule=False)
op(T + "/kpi-actuals/{kpiActualId}/values", "post", "addKpiActualValue", "kpi-actuals",
   "A new value version of an existing slot (a correction or a resubmission), saved as a draft or submitted; never a second slot (REQ-S07-003). An accepted value stays in force until the new one is accepted (kpi_actual.submit). Same refusals as submitKpiActual.",
   params=["TransformationId", "KpiActualId"], body="KpiActualValueEntry", ok_schema="KpiActualSubmission", etag=True, if_match=True)
op(T + "/kpi-actuals/{kpiActualId}/submit", "post", "submitKpiActualDraft", "kpi-actuals",
   "Submit the current draft value (kpi_actual.submit). Review route: submitted and a review task is created; direct-accept route: accepted. 422 kpi_actual.evidence_required, kpi_actual.period_not_open.",
   params=["TransformationId", "KpiActualId"], ok_schema="KpiActualSubmission", etag=True, if_match=True)
op(T + "/kpi-actuals/{kpiActualId}/accept", "post", "acceptKpiActual", "kpi-actuals",
   "Accept the submitted value (kpi_actual.accept; the configured reviewer, not the submitter). Writes one audit event and enqueues one recalculation (REQ-S07-013, REQ-S12-006). 403 kpi_actual.not_reviewer, kpi_actual.sod_submitter; 422 kpi_actual.not_submitted.",
   params=["TransformationId", "KpiActualId"], body="KpiActualDecision", ok_schema="KpiActual", etag=True, if_match=True)
op(T + "/kpi-actuals/{kpiActualId}/reject", "post", "rejectKpiActual", "kpi-actuals",
   "Reject the submitted value with a reason; the submitter gets a correction task (kpi_actual.accept; the configured reviewer, not the submitter). 403 kpi_actual.not_reviewer, kpi_actual.sod_submitter; 422 kpi_actual.not_submitted, kpi_actual.reject_reason_required.",
   params=["TransformationId", "KpiActualId"], body="ReasonRequest", ok_schema="KpiActual", etag=True, if_match=True)
op(T + "/kpi-actual-reviews", "get", "listKpiActualReviewQueue", "kpi-actuals",
   "Submitted values waiting for review that the caller may decide (kpi_actual.accept and the reviewer party), oldest first.",
   params=TP, query=["Cursor", "Limit"], ok_schema="KpiActualPage", forbidden=False, rule=False)

# ----------------------------------------------------------------------------------------------- calculation runs (ADR-0027 §7)
op(T + "/calculation-runs", "get", "listCalculationRuns", "calculation-runs", "Calculation runs, newest first, with their trigger (transformation.read).",
   params=TP, query=["Cursor", "Limit", "KpiDefinitionIdQuery"], ok_schema="CalculationRunPage", forbidden=False, rule=False)
op(T + "/calculation-runs/{calculationRunId}", "get", "getCalculationRun", "calculation-runs",
   "One run with its evaluations: values, statuses, expected values, RAG, inputs and rounding (lineage; transformation.read).",
   params=["TransformationId", "CalculationRunId"], ok_schema="CalculationRun", forbidden=False, rule=False)

# ----------------------------------------------------------------------------------------------- KPI status (ADR-0028 §6)
op(T + "/kpi-status", "get", "listKpiStatus", "kpi-status",
   "The RAG panel of every KPI of the transformation for a scope (default: the transformation) in its current reporting period. Unknown, Stale and Not computable are statuses with reasons, never 0 or green (transformation.read).",
   params=TP, query=["Cursor", "Limit", "ScopeKindQuery", "ScopeIdQuery"], ok_schema="KpiStatusPage", forbidden=False, rule=False)
op(KD + "/status", "get", "getKpiStatus", "kpi-status",
   "The KPI panel (REQ-S07-008): actual, expected-to-date, final target, variance, trend, data freshness and the rule explanation naming the threshold, with the calculated RAG and the displayed RAG (an override in force) (transformation.read).",
   params=KP, query=["ScopeKindQuery", "ScopeIdQuery", "ReportingPeriodIdQuery"], ok_schema="KpiStatus", forbidden=False, rule=False)

# ----------------------------------------------------------------------------------------------- RAG overrides (ADR-0027 §10)
op(KD + "/rag-overrides", "get", "listRagOverrides", "rag-overrides", "Overrides of a KPI, newest first, with whether each is in force (transformation.read).",
   params=KP, query=["Cursor", "Limit"], ok_schema="RagOverridePage", forbidden=False, rule=False)
op(KD + "/rag-overrides", "post", "createRagOverride", "rag-overrides",
   "Override the displayed RAG of one scope and period with reason, evidence and expiry; the calculated RAG is preserved and shown again after expiry (rag.override; TL, BO; others 403). 409 rag_override.already_in_force; 422 rag_override.reason_required, rag_override.evidence_required, rag_override.expiry_required, rag_override.expiry_invalid, kpi.scope_invalid.",
   params=KP, body="RagOverrideCreate", ok="201", ok_desc="Created (in force).", ok_schema="RagOverride", etag=True, location=True, dup=True)
op(T + "/rag-overrides/{ragOverrideId}/revoke", "post", "revokeRagOverride", "rag-overrides",
   "Revoke an override in force with a reason (rag.override). 422 rag_override.not_active.",
   params=["TransformationId", "RagOverrideId"], body="ReasonRequest", ok_schema="RagOverride", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- data quality (ADR-0027 §9)
op(T + "/data-quality-findings", "get", "listDataQualityFindings", "data-quality",
   "Data-quality findings of the transformation's KPIs (missing, stale, out of range, evidence missing, zero denominator, not comparable, negative baseline, scope missing), open first (transformation.read).",
   params=TP, query=["Cursor", "Limit", "KpiDefinitionIdQuery", "FindingStatusQuery"], ok_schema="DataQualityFindingPage", forbidden=False, rule=False)
op(T + "/data-quality-findings/{dataQualityFindingId}", "get", "getDataQualityFinding", "data-quality", "Read one finding (transformation.read).",
   params=["TransformationId", "DataQualityFindingId"], ok_schema="DataQualityFinding", etag=True, forbidden=False, rule=False)
op(T + "/data-quality-findings/{dataQualityFindingId}/resolve", "post", "resolveDataQualityFinding", "data-quality",
   "Resolve or dismiss an open finding with a note (data_quality.manage; TL, KDS). 422 data_quality.not_open, data_quality.note_required.",
   params=["TransformationId", "DataQualityFindingId"], body="DataQualityResolution", ok_schema="DataQualityFinding", etag=True, if_match=True)

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
            if o["if_match"]:
                out.append(f'        "409": {R("VersionConflict")}')
            elif o["dup"]:
                out.append(f'        "409": {R("Duplicate")}')
            if o["rule"] or unsafe:
                out.append(f'        "422": {R("BusinessRule")}')
            if o["if_match"]:
                out.append(f'        "428": {R("PreconditionRequired")}')
            out.append(f'        "429": {R("RateLimited")}')
    return "\n".join(out) + "\n"



UUID = '{ $ref: "#/components/schemas/Uuid" }'
PARAMS = {
    "KpiVersionId": ("kpiVersionId", "path", UUID),
    "ReportingPeriodId": ("reportingPeriodId", "path", UUID),
    "TargetTrajectoryId": ("targetTrajectoryId", "path", UUID),
    "KpiActualId": ("kpiActualId", "path", UUID),
    "CalculationRunId": ("calculationRunId", "path", UUID),
    "RagOverrideId": ("ragOverrideId", "path", UUID),
    "DataQualityFindingId": ("dataQualityFindingId", "path", UUID),
    "FrequencyQuery": ("frequency", "query", "{ type: string, enum: [daily, weekly, monthly, quarterly, annual, ad_hoc] }"),
    "ReportingPeriodStatusQuery": ("status", "query", "{ type: string, enum: [scheduled, open, closed] }"),
    "ScopeKindQuery": ("scopeKind", "query", '{ $ref: "#/components/schemas/KpiScopeKind" }'),
    "ScopeIdQuery": ("scopeId", "query", UUID),
    "ReportingPeriodIdQuery": ("reportingPeriodId", "query", UUID),
    "KpiActualStatusQuery": ("status", "query", "{ type: string, enum: [draft, submitted, accepted, rejected] }"),
    "KpiDefinitionIdQuery": ("kpiDefinitionId", "query", UUID),
    "FindingStatusQuery": ("status", "query", "{ type: string, enum: [open, resolved, dismissed] }"),
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


S = "#/components/schemas/"
SCHEMAS = r'''
    # ---- P4 slice A (T-DG4-ARCH-02; ADR-0027, ADR-0028) -------------------------------------------------------------
    KpiScopeKind:
      type: string
      enum: [transformation, business_unit, initiative]
      description: The scope a KPI value describes (REQ-S07-003). scopeId is the transformation, a business unit of its organization, or one of its initiatives.
    KpiRag:
      type: string
      enum: [green, amber, red, unknown, stale, not_computable]
      description: A RAG status. unknown, stale and not_computable are shown grey and labelled, never as green or 0 (REQ-S07-006).
    KpiValueStatus:
      type: string
      enum: [ok, unknown, stale, not_computable]
    KpiReasonCode:
      type: string
      pattern: "^kpi\\.[a-z_]{1,60}$"
      description: i18n key of an Unknown / Stale / Not computable reason (ADR-0028 §6), e.g. kpi.no_accepted_actual, kpi.zero_denominator.
    KpiFormulaInput:
      type: object
      required: [variableName, sourceKpiDefinitionId, inputBasis]
      additionalProperties: false
      properties:
        variableName: { type: string, pattern: "^[a-z][a-z0-9_]{0,47}$" }
        sourceKpiDefinitionId: { $ref: "#/components/schemas/Uuid" }
        inputBasis: { type: string, enum: [period, cumulative], default: period }
    KpiDataQualityRule:
      type: object
      required: [staleAfterDays, validMin, validMax, evidenceRequired]
      additionalProperties: false
      properties:
        staleAfterDays: { type: integer, minimum: 1, maximum: 3660, default: 45 }
        validMin: { $ref: "#/components/schemas/NullableDecimal" }
        validMax: { $ref: "#/components/schemas/NullableDecimal" }
        evidenceRequired: { type: boolean, default: false }
    KpiVersion:
      type: object
      description: The versioned P4 measurement definition of a KPI (KPIVersion, REQ-S16-014). With the DG2 KpiDefinition it holds every REQ-S07-001 field. Percentage values are fractions (0.12 = 12 %).
      required: [id, transformationId, kpiDefinitionId, versionNo, status, measureType, valueNature, entryScopeKind, unitKind, unitLabel, currency, frequency, numeratorLabel, denominatorLabel, calculationMethod, calculationDescription, formulaExpression, formulaEngineVersion, formulaInputs, aggregationRule, stockAdditiveAcrossScopes, ytdStartMonth, baselineId, baselineValue, baselineDate, targetValue, targetDate, bandLower, bandUpper, milestoneDueDate, dataQuality, submissionRoute, reviewerPartyCode, definitionApproval, approvalId, changeReason, activatedAt, activatedBy, supersededAt, withdrawnAt, withdrawnBy, withdrawReason, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        kpiDefinitionId: { $ref: "#/components/schemas/Uuid" }
        versionNo: { type: integer, minimum: 1 }
        status: { type: string, enum: [draft, active, superseded, withdrawn] }
        measureType: { type: string, enum: [higher_is_better, lower_is_better, acceptable_band, binary_milestone] }
        valueNature: { type: string, enum: [flow, stock, ratio, milestone] }
        entryScopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        unitKind: { type: string, enum: [currency, percentage, count, ratio, duration, score, other] }
        unitLabel: { type: [string, "null"] }
        currency: { oneOf: [{ $ref: "#/components/schemas/Currency" }, { type: "null" }] }
        frequency: { type: string, enum: [daily, weekly, monthly, quarterly, annual, ad_hoc] }
        numeratorLabel: { type: [string, "null"] }
        denominatorLabel: { type: [string, "null"] }
        calculationMethod: { type: string, enum: [entered, formula] }
        calculationDescription: { type: [string, "null"] }
        formulaExpression: { type: [string, "null"] }
        formulaEngineVersion: { type: [string, "null"] }
        formulaInputs: { type: array, items: { $ref: "#/components/schemas/KpiFormulaInput" } }
        aggregationRule: { type: [string, "null"], enum: [sum, last_value, weighted_ratio, custom_formula, none, null], description: "null only on a draft; required to activate (D-089 Q1)." }
        stockAdditiveAcrossScopes: { type: boolean }
        ytdStartMonth: { type: integer, minimum: 1, maximum: 12 }
        baselineId: { $ref: "#/components/schemas/NullableUuid" }
        baselineValue: { $ref: "#/components/schemas/NullableDecimal" }
        baselineDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        targetValue: { $ref: "#/components/schemas/NullableDecimal" }
        targetDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        bandLower: { $ref: "#/components/schemas/NullableDecimal" }
        bandUpper: { $ref: "#/components/schemas/NullableDecimal" }
        milestoneDueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        dataQuality: { $ref: "#/components/schemas/KpiDataQualityRule" }
        submissionRoute: { type: string, enum: [review, direct_accept] }
        reviewerPartyCode: { oneOf: [{ $ref: "#/components/schemas/PartyCode" }, { type: "null" }] }
        definitionApproval: { type: string, enum: [direct, business_approval] }
        approvalId: { $ref: "#/components/schemas/NullableUuid" }
        changeReason: { type: [string, "null"] }
        activatedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        activatedBy: { $ref: "#/components/schemas/NullableUuid" }
        supersededAt: { $ref: "#/components/schemas/NullableTimestamp" }
        withdrawnAt: { $ref: "#/components/schemas/NullableTimestamp" }
        withdrawnBy: { $ref: "#/components/schemas/NullableUuid" }
        withdrawReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    KpiVersionCreate:
      type: object
      required: [measureType, valueNature]
      additionalProperties: false
      properties:
        measureType: { type: string, enum: [higher_is_better, lower_is_better, acceptable_band, binary_milestone] }
        valueNature: { type: string, enum: [flow, stock, ratio, milestone] }
        entryScopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        unitLabel: { type: [string, "null"], minLength: 1, maxLength: 50 }
        numeratorLabel: { type: [string, "null"], minLength: 1, maxLength: 200 }
        denominatorLabel: { type: [string, "null"], minLength: 1, maxLength: 200 }
        calculationMethod: { type: string, enum: [entered, formula], default: entered }
        calculationDescription: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        formulaExpression: { type: [string, "null"], minLength: 1, maxLength: 2000 }
        formulaInputs: { type: array, maxItems: 30, items: { $ref: "#/components/schemas/KpiFormulaInput" } }
        aggregationRule: { type: [string, "null"], enum: [sum, last_value, weighted_ratio, custom_formula, none, null] }
        stockAdditiveAcrossScopes: { type: boolean, default: false }
        ytdStartMonth: { type: integer, minimum: 1, maximum: 12, default: 1 }
        baselineId: { $ref: "#/components/schemas/NullableUuid" }
        baselineValue: { $ref: "#/components/schemas/NullableDecimal" }
        baselineDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        targetValue: { $ref: "#/components/schemas/NullableDecimal" }
        targetDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        bandLower: { $ref: "#/components/schemas/NullableDecimal" }
        bandUpper: { $ref: "#/components/schemas/NullableDecimal" }
        milestoneDueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        dataQuality: { $ref: "#/components/schemas/KpiDataQualityRule" }
        submissionRoute: { type: string, enum: [review, direct_accept], default: review }
        reviewerPartyCode: { oneOf: [{ $ref: "#/components/schemas/PartyCode" }, { type: "null" }] }
        definitionApproval: { type: string, enum: [direct, business_approval], default: direct }
        changeReason: { type: [string, "null"], minLength: 3, maxLength: 2000 }
    KpiVersionUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      description: Any KpiVersionCreate member except calculationMethod, formulaExpression and formulaInputs (a different formula is a new draft).
      properties:
        measureType: { type: string, enum: [higher_is_better, lower_is_better, acceptable_band, binary_milestone] }
        valueNature: { type: string, enum: [flow, stock, ratio, milestone] }
        entryScopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        unitLabel: { type: [string, "null"], minLength: 1, maxLength: 50 }
        numeratorLabel: { type: [string, "null"], minLength: 1, maxLength: 200 }
        denominatorLabel: { type: [string, "null"], minLength: 1, maxLength: 200 }
        calculationDescription: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        aggregationRule: { type: [string, "null"], enum: [sum, last_value, weighted_ratio, custom_formula, none, null] }
        stockAdditiveAcrossScopes: { type: boolean }
        ytdStartMonth: { type: integer, minimum: 1, maximum: 12 }
        baselineId: { $ref: "#/components/schemas/NullableUuid" }
        baselineValue: { $ref: "#/components/schemas/NullableDecimal" }
        baselineDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        targetValue: { $ref: "#/components/schemas/NullableDecimal" }
        targetDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        bandLower: { $ref: "#/components/schemas/NullableDecimal" }
        bandUpper: { $ref: "#/components/schemas/NullableDecimal" }
        milestoneDueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        dataQuality: { $ref: "#/components/schemas/KpiDataQualityRule" }
        submissionRoute: { type: string, enum: [review, direct_accept] }
        reviewerPartyCode: { oneOf: [{ $ref: "#/components/schemas/PartyCode" }, { type: "null" }] }
        definitionApproval: { type: string, enum: [direct, business_approval] }
        changeReason: { type: [string, "null"], minLength: 3, maxLength: 2000 }
    KpiVersionApprovalRequest:
      type: object
      additionalProperties: false
      properties:
        requestNote: { type: [string, "null"], minLength: 1, maxLength: 4000 }
    KpiDictionaryEntry:
      type: object
      required: [definition, activeVersion, draftVersionId, missingForUse]
      additionalProperties: false
      properties:
        definition: { $ref: "#/components/schemas/KpiDefinition" }
        activeVersion: { oneOf: [{ $ref: "#/components/schemas/KpiVersion" }, { type: "null" }] }
        draftVersionId: { $ref: "#/components/schemas/NullableUuid" }
        missingForUse:
          type: array
          description: What still blocks P4 use (empty when a complete version is active), e.g. active_version, aggregation_rule, approved_trajectory.
          items: { type: string, enum: [definition_active, active_version, aggregation_rule, approved_trajectory] }
    KpiRagThreshold:
      type: object
      required: [id, kpiDefinitionId, versionNo, toleranceMode, amberThreshold, redThreshold, reason, status, supersededAt, version, createdAt, createdBy]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        kpiDefinitionId: { $ref: "#/components/schemas/Uuid" }
        versionNo: { type: integer, minimum: 1 }
        toleranceMode: { type: string, enum: [relative, absolute] }
        amberThreshold: { $ref: "#/components/schemas/Decimal" }
        redThreshold: { $ref: "#/components/schemas/Decimal" }
        reason: { type: string }
        status: { type: string, enum: [active, superseded] }
        supersededAt: { $ref: "#/components/schemas/NullableTimestamp" }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
    KpiRagThresholdCreate:
      type: object
      required: [toleranceMode, amberThreshold, redThreshold, reason]
      additionalProperties: false
      properties:
        toleranceMode: { type: string, enum: [relative, absolute] }
        amberThreshold: { $ref: "#/components/schemas/Decimal" }
        redThreshold: { $ref: "#/components/schemas/Decimal" }
        reason: { type: string, minLength: 3, maxLength: 2000 }
    ReportingPeriod:
      type: object
      required: [id, organizationId, frequency, periodLabel, periodStart, periodEnd, lengthDays, basis, weekCount, updateDueDate, status, openedAt, closedAt, version, createdAt, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        organizationId: { $ref: "#/components/schemas/Uuid" }
        frequency: { type: string, enum: [daily, weekly, monthly, quarterly, annual, ad_hoc] }
        periodLabel: { type: string }
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
        lengthDays: { type: integer, minimum: 1 }
        basis: { type: string, enum: [calendar, weeks] }
        weekCount: { type: [integer, "null"], minimum: 1, maximum: 53 }
        updateDueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        status: { type: string, enum: [scheduled, open, closed] }
        openedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        closedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    ReportingPeriodCreate:
      type: object
      required: [frequency, periodLabel, periodStart, periodEnd]
      additionalProperties: false
      properties:
        frequency: { type: string, enum: [daily, weekly, monthly, quarterly, annual, ad_hoc] }
        periodLabel: { type: string, pattern: "^[0-9A-Za-z][0-9A-Za-z_.-]{0,31}$" }
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
        basis: { type: string, enum: [calendar, weeks], default: calendar }
        weekCount: { type: [integer, "null"], minimum: 1, maximum: 53 }
        updateDueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
    KpiTrajectoryPoint:
      type: object
      required: [pointDate, expectedValue]
      additionalProperties: false
      properties:
        pointDate: { $ref: "#/components/schemas/BusinessDate" }
        expectedValue: { $ref: "#/components/schemas/Decimal" }
    TargetTrajectory:
      type: object
      required: [id, transformationId, kpiDefinitionId, scopeKind, scopeId, versionNo, basis, interpolation, source, sourceOutcomeKpiId, status, points, approvedBy, approvedAt, supersededAt, withdrawnAt, withdrawReason, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        kpiDefinitionId: { $ref: "#/components/schemas/Uuid" }
        scopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        versionNo: { type: integer, minimum: 1 }
        basis: { type: string, enum: [period, cumulative] }
        interpolation: { type: string, enum: [linear, step] }
        source: { type: string, enum: [api, outcome_kpi_import, outcome_kpi_backfill] }
        sourceOutcomeKpiId: { $ref: "#/components/schemas/NullableUuid" }
        status: { type: string, enum: [draft, approved, superseded, withdrawn] }
        points: { type: array, items: { $ref: "#/components/schemas/KpiTrajectoryPoint" } }
        approvedBy: { $ref: "#/components/schemas/NullableUuid" }
        approvedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        supersededAt: { $ref: "#/components/schemas/NullableTimestamp" }
        withdrawnAt: { $ref: "#/components/schemas/NullableTimestamp" }
        withdrawReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    TargetTrajectoryCreate:
      type: object
      required: [scopeKind, scopeId]
      additionalProperties: false
      description: Either points (1-120, distinct dates) or sourceOutcomeKpiId (copies that T02 row's current points; source outcome_kpi_import), not both.
      properties:
        scopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        basis: { type: string, enum: [period, cumulative], default: period }
        interpolation: { type: string, enum: [linear, step], default: linear }
        points: { type: array, minItems: 1, maxItems: 120, items: { $ref: "#/components/schemas/KpiTrajectoryPoint" } }
        sourceOutcomeKpiId: { $ref: "#/components/schemas/Uuid" }
    TargetTrajectoryApproval:
      type: object
      additionalProperties: false
      properties:
        comment: { type: [string, "null"], minLength: 1, maxLength: 2000 }
    KpiActualValue:
      type: object
      required: [valueNo, kpiVersionId, value, numerator, denominator, milestoneAchieved, achievedOn, currency, missingReason, dataAsOf, comment, evidenceIds, enteredAt, enteredBy, businessDate]
      additionalProperties: false
      properties:
        valueNo: { type: integer, minimum: 1 }
        kpiVersionId: { $ref: "#/components/schemas/Uuid" }
        value: { $ref: "#/components/schemas/NullableDecimal" }
        numerator: { $ref: "#/components/schemas/NullableDecimal" }
        denominator: { $ref: "#/components/schemas/NullableDecimal" }
        milestoneAchieved: { type: [boolean, "null"] }
        achievedOn: { $ref: "#/components/schemas/NullableBusinessDate" }
        currency: { oneOf: [{ $ref: "#/components/schemas/Currency" }, { type: "null" }] }
        missingReason: { type: [string, "null"], description: "An explicitly unavailable value: value fields null (Unknown, never 0)." }
        dataAsOf: { $ref: "#/components/schemas/BusinessDate" }
        comment: { type: [string, "null"] }
        evidenceIds: { type: array, items: { $ref: "#/components/schemas/Uuid" } }
        enteredAt: { $ref: "#/components/schemas/Timestamp" }
        enteredBy: { $ref: "#/components/schemas/Uuid" }
        businessDate: { $ref: "#/components/schemas/BusinessDate" }
    KpiActualReview:
      type: object
      required: [valueNo, outcome, reason, decidedBy, onBehalfOfUserId, decidedAt]
      additionalProperties: false
      properties:
        valueNo: { type: integer, minimum: 1 }
        outcome: { type: string, enum: [accept, reject, direct_accept] }
        reason: { type: [string, "null"] }
        decidedBy: { $ref: "#/components/schemas/Uuid" }
        onBehalfOfUserId: { $ref: "#/components/schemas/NullableUuid" }
        decidedAt: { $ref: "#/components/schemas/Timestamp" }
    KpiActual:
      type: object
      description: One actual slot per KPI, scope and reporting period (KPIActual, REQ-S16-014) with every value version (REQ-S07-003).
      required: [id, transformationId, kpiDefinitionId, scopeKind, scopeId, reportingPeriodId, periodStart, periodEnd, periodLabel, currentValueNo, acceptedValueNo, status, route, submittedBy, submittedAt, decidedBy, decidedAt, decisionReason, values, reviews, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        kpiDefinitionId: { $ref: "#/components/schemas/Uuid" }
        scopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        reportingPeriodId: { $ref: "#/components/schemas/Uuid" }
        periodStart: { $ref: "#/components/schemas/BusinessDate" }
        periodEnd: { $ref: "#/components/schemas/BusinessDate" }
        periodLabel: { type: string }
        currentValueNo: { type: integer, minimum: 1 }
        acceptedValueNo: { type: [integer, "null"], minimum: 1, description: "The value used in calculations; null = none accepted (Unknown)." }
        status: { type: string, enum: [draft, submitted, accepted, rejected] }
        route: { type: string, enum: [review, direct_accept] }
        submittedBy: { $ref: "#/components/schemas/NullableUuid" }
        submittedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        decidedBy: { $ref: "#/components/schemas/NullableUuid" }
        decidedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        decisionReason: { type: [string, "null"] }
        values: { type: array, items: { $ref: "#/components/schemas/KpiActualValue" } }
        reviews: { type: array, items: { $ref: "#/components/schemas/KpiActualReview" } }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    KpiActualValueEntry:
      type: object
      required: [action, dataAsOf]
      additionalProperties: false
      description: Enter value (flow, stock), numerator and denominator (ratio) or milestoneAchieved (milestone), or missingReason with no value. currency must equal the KPI's (never converted).
      properties:
        action: { type: string, enum: [save_draft, submit] }
        value: { $ref: "#/components/schemas/NullableDecimal" }
        numerator: { $ref: "#/components/schemas/NullableDecimal" }
        denominator: { $ref: "#/components/schemas/NullableDecimal" }
        milestoneAchieved: { type: [boolean, "null"] }
        achievedOn: { $ref: "#/components/schemas/NullableBusinessDate" }
        currency: { oneOf: [{ $ref: "#/components/schemas/Currency" }, { type: "null" }] }
        missingReason: { type: [string, "null"], minLength: 1, maxLength: 1000 }
        dataAsOf: { $ref: "#/components/schemas/BusinessDate" }
        comment: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        evidenceIds: { type: array, maxItems: 20, uniqueItems: true, items: { $ref: "#/components/schemas/Uuid" } }
    KpiActualEntry:
      type: object
      required: [scopeKind, scopeId, reportingPeriodId, action, dataAsOf]
      additionalProperties: false
      description: The first value of a slot - KpiActualValueEntry plus the slot (scope and reporting period).
      properties:
        scopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        reportingPeriodId: { $ref: "#/components/schemas/Uuid" }
        action: { type: string, enum: [save_draft, submit] }
        value: { $ref: "#/components/schemas/NullableDecimal" }
        numerator: { $ref: "#/components/schemas/NullableDecimal" }
        denominator: { $ref: "#/components/schemas/NullableDecimal" }
        milestoneAchieved: { type: [boolean, "null"] }
        achievedOn: { $ref: "#/components/schemas/NullableBusinessDate" }
        currency: { oneOf: [{ $ref: "#/components/schemas/Currency" }, { type: "null" }] }
        missingReason: { type: [string, "null"], minLength: 1, maxLength: 1000 }
        dataAsOf: { $ref: "#/components/schemas/BusinessDate" }
        comment: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        evidenceIds: { type: array, maxItems: 20, uniqueItems: true, items: { $ref: "#/components/schemas/Uuid" } }
    KpiDownstreamItem:
      type: object
      required: [kind, id, labelKey]
      additionalProperties: false
      properties:
        kind: { type: string, enum: [kpi_panel, formula_kpi, outcome_kpi, executive_overview_outcomes, dashboard, benefit] }
        id: { $ref: "#/components/schemas/NullableUuid" }
        labelKey: { type: string, description: "i18n key or the record's own name source; translated at render time." }
    KpiActualSubmission:
      type: object
      required: [actual, reviewPending, downstream, financeReview]
      additionalProperties: false
      properties:
        actual: { $ref: "#/components/schemas/KpiActual" }
        reviewPending: { type: boolean }
        downstream: { type: array, items: { $ref: "#/components/schemas/KpiDownstreamItem" } }
        financeReview: { type: string, enum: [pending, not_applicable, unknown], description: "unknown until slice B reports benefit impact; never guessed." }
    KpiActualDecision:
      type: object
      additionalProperties: false
      properties:
        comment: { type: [string, "null"], minLength: 1, maxLength: 2000 }
    KpiEvaluation:
      type: object
      required: [id, kpiDefinitionId, kpiVersionId, scopeKind, scopeId, reportingPeriodId, periodLabel, valueBasis, value, valueStatus, valueReason, valueSource, currency, inputs, rounding, expectedValue, finalTarget, variance, varianceRatio, comparisonFlag, trend, dataAsOf, calculatedRag, deviation, thresholdId, thresholdSource, targetTrajectoryId, explanationKey, explanationParams, evaluatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        kpiDefinitionId: { $ref: "#/components/schemas/Uuid" }
        kpiVersionId: { $ref: "#/components/schemas/Uuid" }
        scopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        reportingPeriodId: { $ref: "#/components/schemas/Uuid" }
        periodLabel: { type: string }
        valueBasis: { type: string, enum: [period, cumulative] }
        value: { $ref: "#/components/schemas/NullableDecimal" }
        valueStatus: { $ref: "#/components/schemas/KpiValueStatus" }
        valueReason: { oneOf: [{ $ref: "#/components/schemas/KpiReasonCode" }, { type: "null" }] }
        valueSource: { type: string, enum: [entered, rolled_up, formula, none] }
        currency: { oneOf: [{ $ref: "#/components/schemas/Currency" }, { type: "null" }] }
        inputs: { type: object }
        rounding: { type: [object, "null"] }
        expectedValue: { $ref: "#/components/schemas/NullableDecimal" }
        finalTarget: { $ref: "#/components/schemas/NullableDecimal" }
        variance: { $ref: "#/components/schemas/NullableDecimal" }
        varianceRatio: { $ref: "#/components/schemas/NullableDecimal" }
        comparisonFlag: { type: [string, "null"], enum: [negative_baseline, not_comparable, zero_base, null] }
        trend: { type: string, enum: [improving, worsening, flat, not_comparable, unknown] }
        dataAsOf: { $ref: "#/components/schemas/NullableBusinessDate" }
        calculatedRag: { $ref: "#/components/schemas/KpiRag" }
        deviation: { type: string, enum: [favourable, within, adverse, unknown] }
        thresholdId: { $ref: "#/components/schemas/NullableUuid" }
        thresholdSource: { type: string, enum: [configured, default, none] }
        targetTrajectoryId: { $ref: "#/components/schemas/NullableUuid" }
        explanationKey: { type: string, pattern: "^kpi\\.rag\\.[a-z_]{1,60}$" }
        explanationParams: { type: object }
        evaluatedAt: { $ref: "#/components/schemas/Timestamp" }
    CalculationRun:
      type: object
      required: [id, seq, transformationId, triggerKind, triggerRecordType, triggerRecordId, triggerSlot, status, errorCode, evaluationCount, findingCount, formulaEngineVersion, kpiRulesVersion, startedAt, completedAt, evaluations]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        seq: { type: string, pattern: "^[0-9]{1,19}$" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        triggerKind: { type: string, enum: [actual_accepted, threshold_changed, trajectory_approved, version_activated] }
        triggerRecordType: { type: string, enum: [kpi_actual, kpi_rag_threshold, target_trajectory, kpi_version] }
        triggerRecordId: { $ref: "#/components/schemas/Uuid" }
        triggerSlot: { type: integer, minimum: 1 }
        status: { type: string, enum: [completed, failed] }
        errorCode: { type: [string, "null"] }
        evaluationCount: { type: integer, minimum: 0 }
        findingCount: { type: integer, minimum: 0 }
        formulaEngineVersion: { type: string }
        kpiRulesVersion: { type: string }
        startedAt: { $ref: "#/components/schemas/Timestamp" }
        completedAt: { $ref: "#/components/schemas/Timestamp" }
        evaluations: { type: array, description: "Empty in list responses; the run's evaluations in getCalculationRun.", items: { $ref: "#/components/schemas/KpiEvaluation" } }
    KpiStatusExplanation:
      type: object
      required: [key, params, thresholdSource, thresholdVersion, toleranceMode, amberThreshold, redThreshold, trajectoryVersion]
      additionalProperties: false
      properties:
        key: { type: string, pattern: "^kpi\\.rag\\.[a-z_]{1,60}$" }
        params: { type: object }
        thresholdSource: { type: string, enum: [configured, default, none] }
        thresholdVersion: { type: [integer, "null"], minimum: 1 }
        toleranceMode: { type: [string, "null"], enum: [relative, absolute, null] }
        amberThreshold: { $ref: "#/components/schemas/NullableDecimal" }
        redThreshold: { $ref: "#/components/schemas/NullableDecimal" }
        trajectoryVersion: { type: [integer, "null"], minimum: 1 }
    RagOverrideInForce:
      type: object
      required: [id, rag, reason, evidenceId, expiresAt, createdBy]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        rag: { type: string, enum: [green, amber, red] }
        reason: { type: string }
        evidenceId: { $ref: "#/components/schemas/Uuid" }
        expiresAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
    KpiStatus:
      type: object
      description: The KPI panel (REQ-S07-008). The seven elements are always present; a missing one is null with a reason, never 0.
      required: [kpiDefinitionId, kpiName, kpiVersionId, unitKind, currency, scopeKind, scopeId, reportingPeriodId, periodLabel, actual, actualStatus, actualReason, expectedToDate, expectedReason, finalTarget, finalTargetDate, variance, varianceRatio, changeLabel, trend, freshness, explanation, calculatedRag, displayedRag, override, evaluationId, calculationRunId]
      additionalProperties: false
      properties:
        kpiDefinitionId: { $ref: "#/components/schemas/Uuid" }
        kpiName: { type: string }
        kpiVersionId: { $ref: "#/components/schemas/NullableUuid" }
        unitKind: { type: string, enum: [currency, percentage, count, ratio, duration, score, other] }
        currency: { oneOf: [{ $ref: "#/components/schemas/Currency" }, { type: "null" }] }
        scopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        reportingPeriodId: { $ref: "#/components/schemas/NullableUuid" }
        periodLabel: { type: [string, "null"] }
        actual: { $ref: "#/components/schemas/NullableDecimal" }
        actualStatus: { $ref: "#/components/schemas/KpiValueStatus" }
        actualReason: { oneOf: [{ $ref: "#/components/schemas/KpiReasonCode" }, { type: "null" }] }
        expectedToDate: { $ref: "#/components/schemas/NullableDecimal" }
        expectedReason: { oneOf: [{ $ref: "#/components/schemas/KpiReasonCode" }, { type: "null" }] }
        finalTarget: { $ref: "#/components/schemas/NullableDecimal" }
        finalTargetDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        variance: { $ref: "#/components/schemas/NullableDecimal" }
        varianceRatio: { $ref: "#/components/schemas/NullableDecimal" }
        changeLabel: { type: string, enum: [pp, percent, unit], description: "pp for a percentage KPI's point variance; percent for a relative change; unit otherwise (ADR-0028 §3)." }
        trend: { type: string, enum: [improving, worsening, flat, not_comparable, unknown] }
        freshness:
          type: object
          required: [status, dataAsOf, staleAfterDays]
          additionalProperties: false
          properties:
            status: { type: string, enum: [fresh, stale, unknown] }
            dataAsOf: { $ref: "#/components/schemas/NullableBusinessDate" }
            staleAfterDays: { type: [integer, "null"], minimum: 1 }
        explanation: { $ref: "#/components/schemas/KpiStatusExplanation" }
        calculatedRag: { $ref: "#/components/schemas/KpiRag" }
        displayedRag: { $ref: "#/components/schemas/KpiRag" }
        override: { oneOf: [{ $ref: "#/components/schemas/RagOverrideInForce" }, { type: "null" }] }
        evaluationId: { $ref: "#/components/schemas/NullableUuid" }
        calculationRunId: { $ref: "#/components/schemas/NullableUuid" }
    RagOverride:
      type: object
      required: [id, transformationId, kpiDefinitionId, scopeKind, scopeId, reportingPeriodId, overrideRag, calculatedRag, kpiEvaluationId, reason, evidenceId, expiresAt, inForce, status, revokedBy, revokedAt, revokeReason, version, createdAt, createdBy, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        kpiDefinitionId: { $ref: "#/components/schemas/Uuid" }
        scopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        reportingPeriodId: { $ref: "#/components/schemas/Uuid" }
        overrideRag: { type: string, enum: [green, amber, red] }
        calculatedRag: { $ref: "#/components/schemas/KpiRag" }
        kpiEvaluationId: { $ref: "#/components/schemas/NullableUuid" }
        reason: { type: string }
        evidenceId: { $ref: "#/components/schemas/Uuid" }
        expiresAt: { $ref: "#/components/schemas/Timestamp" }
        inForce: { type: boolean, description: "status active and the current time before expiresAt." }
        status: { type: string, enum: [active, revoked] }
        revokedBy: { $ref: "#/components/schemas/NullableUuid" }
        revokedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        revokeReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    RagOverrideCreate:
      type: object
      required: [scopeKind, scopeId, reportingPeriodId, overrideRag]
      additionalProperties: false
      description: reason, evidenceId and expiresAt are required by the business rule, not by the schema, so that a missing one is refused with its own 422 (rag_override.reason_required, rag_override.evidence_required, rag_override.expiry_required; REQ-S07-009) and nothing is written.
      properties:
        scopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        reportingPeriodId: { $ref: "#/components/schemas/Uuid" }
        overrideRag: { type: string, enum: [green, amber, red] }
        reason: { type: [string, "null"], maxLength: 2000 }
        evidenceId: { $ref: "#/components/schemas/NullableUuid" }
        expiresAt: { $ref: "#/components/schemas/NullableTimestamp" }
    DataQualityFinding:
      type: object
      required: [id, transformationId, kpiDefinitionId, scopeKind, scopeId, reportingPeriodId, kpiActualId, valueNo, ruleCode, severity, detailParams, detectedByRunId, detectedAt, status, resolutionNote, resolvedBy, resolvedAt, version, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        kpiDefinitionId: { $ref: "#/components/schemas/Uuid" }
        scopeKind: { $ref: "#/components/schemas/KpiScopeKind" }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        reportingPeriodId: { $ref: "#/components/schemas/Uuid" }
        kpiActualId: { $ref: "#/components/schemas/NullableUuid" }
        valueNo: { type: [integer, "null"], minimum: 1 }
        ruleCode: { type: string, enum: [missing_actual, stale, out_of_range, evidence_missing, zero_denominator, not_comparable, negative_baseline, scope_missing] }
        severity: { type: string, enum: [info, warning] }
        detailParams: { type: object }
        detectedByRunId: { $ref: "#/components/schemas/Uuid" }
        detectedAt: { $ref: "#/components/schemas/Timestamp" }
        status: { type: string, enum: [open, resolved, dismissed] }
        resolutionNote: { type: [string, "null"] }
        resolvedBy: { $ref: "#/components/schemas/NullableUuid" }
        resolvedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        version: { $ref: "#/components/schemas/Version" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    DataQualityResolution:
      type: object
      required: [outcome, note]
      additionalProperties: false
      properties:
        outcome: { type: string, enum: [resolved, dismissed] }
        note: { type: string, minLength: 3, maxLength: 2000 }
''' + "".join(page(n, i) for n, i in [
    ("KpiDictionaryPage", "KpiDictionaryEntry"), ("KpiVersionPage", "KpiVersion"), ("KpiRagThresholdPage", "KpiRagThreshold"),
    ("ReportingPeriodPage", "ReportingPeriod"), ("TargetTrajectoryPage", "TargetTrajectory"), ("KpiActualPage", "KpiActual"),
    ("CalculationRunPage", "CalculationRun"), ("KpiStatusPage", "KpiStatus"), ("RagOverridePage", "RagOverride"),
    ("DataQualityFindingPage", "DataQualityFinding")])

TAGS = '''  - name: kpi-versions
    description: KPI dictionary v2 - versions, formula inputs, RAG threshold versions (P4, ADR-0027).
  - name: reporting-periods
    description: Reporting periods per organization and frequency (P4, ADR-0027).
  - name: target-trajectories
    description: Approved expected trajectories per KPI and scope (P4, ADR-0027).
  - name: kpi-actuals
    description: KPI actuals by KPI, scope and reporting period with value versions, review or direct-accept routes (P4, ADR-0027).
  - name: calculation-runs
    description: Calculation runs and their KPI evaluations (lineage) (P4, ADR-0027).
  - name: kpi-status
    description: The KPI RAG panel with its seven elements (P4, ADR-0028).
  - name: rag-overrides
    description: Manual RAG overrides with reason, evidence and expiry (P4, ADR-0027).
  - name: data-quality
    description: KPI data-quality findings (P4, ADR-0027).
'''

INFO_ADD = '''
    **P4 additions, slice A (T-DG4-ARCH-02, ADR-0027, ADR-0028).** Additive within v1: new paths, schemas and tags.
    The DG2 KPI-definition operations are byte-stable; the P4 dictionary fields live on KPI versions, and an aggregation
    rule is required to activate a version (D-089 Q1). KPI values are decimal strings; percentages are fractions. A
    missing, stale or not computable value is a status with a reason, never 0 or green. RAG comes from the approved
    trajectory and the threshold version in force, never from task completion. Trajectory approval is a business approval.
'''


def main(path):
    s = open(path, encoding="utf-8").read()
    assert "operationId: listKpiDictionary" not in s, "already applied"
    assert "  version: 1.3.0-p4\n" in s
    anchor = "    by named people: a timer escalates an overdue approval once per due date and never decides it.\n"
    assert anchor in s
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
    s = s.rstrip("\n") + "\n" + SCHEMAS
    open(path, "w", encoding="utf-8").write(s)
    print(f"added {len(OPS)} operations: " + ", ".join(o["id"] for o in OPS))


if __name__ == "__main__":
    main(sys.argv[1])
