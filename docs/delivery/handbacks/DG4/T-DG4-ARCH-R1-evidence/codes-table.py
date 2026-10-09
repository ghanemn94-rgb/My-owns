# T-DG4-ARCH-R1 item 11: the consolidated table of codes and keys added outside the ADRs (solution-architect).
# Source of the list: (a) the codes each named handback reports, and (b) the mechanical scan in codes-scan.py: every
# double-quoted dotted literal in apps/api/src, apps/worker/src and packages/shared/src (non-test) that is new since the
# DG3-approved commit d3e6fe6 and appears in no ADR (codes-scan-output.txt). Text "server" = the English detail the API
# already sends (copied from the source); "authored" = written here, because the server sends only the key (zod refine
# messages and work-item/notice/reason keys), so the web client renders this text. {name} = a parameter the server sends.
# Run: python3 codes-table.py > codes-table.md
ROWS = [
    # code, kind, ADR, decision, text, origin, where
    # ---- ADR-0025 (scheduled-job kit, work items)
    ("validation.job_code", "400 field", "ADR-0025", "accepted", "A job code is two lower-case words joined by a dot, such as kpi.reporting_period_open.", "authored", "shared schemas/jobs.ts"),
    ("validation.link_path", "400 field", "ADR-0025", "accepted", "A link must be a path inside this application that starts with a single '/'.", "authored", "shared schemas/tasks.ts"),
    ("validation.pattern", "400 field", "ADR-0025", "accepted", "Use lower-case letters and '_' only.", "authored", "api tasks/routes.ts; shared schemas/delegations.ts"),
    # ---- ADR-0026 (groups, role mapping, delegation, approvals, T11/T12)
    ("group.code_taken", "409", "ADR-0026", "accepted", "A group with the code {code} already exists in this organization.", "server", "api access/groups.ts"),
    ("group.member_exists", "409", "ADR-0026", "accepted", "This person is already a current member of the group.", "server", "api access/groups.ts"),
    ("group.member_other_organization", "422", "ADR-0026", "accepted", "Only an active user of the group's organization can be a member.", "server", "api access/groups.ts"),
    ("group.owner_invalid", "422", "ADR-0026", "accepted", "The owner must be an active user of the group's organization.", "server", "api access/groups.ts"),
    ("group.archived", "422", "ADR-0026", "accepted", "This group is archived. Reactivate it before adding members.", "server", "api access/groups.ts"),
    ("group.member_removed", "422", "ADR-0026", "accepted", "This member has already been removed.", "server", "api access/groups.ts"),
    ("group.member_window_invalid", "422", "ADR-0026", "accepted", "A membership must end after it starts.", "server", "api access/groups.ts"),
    ("role_mapping.already_mapped", "409", "ADR-0026", "accepted", "This party is already mapped in this transformation. End the current mapping first.", "server", "api access/role-mappings.ts"),
    ("role_mapping.party_unknown", "422", "ADR-0026", "accepted", "{party} is not a known governance role.", "server", "api access/role-mappings.ts"),
    ("role_mapping.target_invalid", "422", "ADR-0026", "accepted", "Map the party to an active user, or an active group, of this transformation's organization.", "server", "api access/role-mappings.ts"),
    ("role_mapping.ended", "422", "ADR-0026", "accepted", "This mapping has already ended. Create a new mapping instead.", "server", "api access/role-mappings.ts"),
    ("validation.party_unknown", "400 field", "ADR-0026", "accepted", "{party} is not a known governance role.", "server", "api access/role-mappings.ts (/query/party)"),
    ("validation.party_code", "400 field", "ADR-0026", "accepted", "A governance role code starts with a capital letter and uses A-Z, 0-9 and '_' (up to 32 characters).", "authored", "shared schemas/groups.ts"),
    ("validation.duplicate_party", "400 field", "ADR-0026", "accepted", "Each governance role can appear only once in a row.", "authored", "shared schemas/governance.ts"),
    ("raci.party_unknown", "422", "ADR-0026", "accepted", "{party} is not a known governance role.", "server", "api governance/raci.ts"),
    ("delegation.delegate_unknown", "422", "ADR-0026", "accepted", "The delegate must be an active user of the delegator's organization.", "server", "api access/delegations.ts"),
    ("delegation.scope_invalid", "422", "ADR-0026", "accepted", "The scope must be the delegator's organization, one of its business units or one of its transformations.", "server", "api access/delegations.ts"),
    ("validation.scope_pair", "400 field", "ADR-0026", "accepted", "Give scopeType and scopeId together.", "server", "api access/delegations.ts"),
    ("approval.decision_right_unknown", "422", "ADR-0026", "accepted", "Choose an active decision right of this transformation.", "server", "api workflows/approvals.ts; governance/decision-rights.ts"),
    ("approval.subject_unknown", "422", "ADR-0026", "accepted", "The record to approve does not exist in this transformation.", "server", "api workflows/approvals.ts"),
    ("approval.calendar_not_configured", "422", "ADR-0026", "accepted", "Configure the organization's default business calendar before deferring this approval.", "server", "api workflows/approvals.ts"),
    ("validation.defer_only", "400 field", "ADR-0026", "accepted", "Only a deferral takes a new date.", "server", "api workflows/approvals.ts"),
    ("approval.resubmit_through_record", "422", "ADR-0026", "new (§4.1 amendment; BE-R2 implements)", "Resubmit this request by submitting its record again.", "authored", "to be added to workflows/approvals.ts"),
    ("approvals.task.decide", "message key", "ADR-0026", "accepted", "Decide: {title} (round {roundNo}), due {dueDate}.", "authored", "api workflows/approvals.ts"),
    ("approvals.task.changes_requested", "message key", "ADR-0026", "accepted", "Changes were requested on {title} (round {roundNo}). Update the record and resubmit, or withdraw.", "authored", "api workflows/approvals.ts"),
    ("approvals.task.outcome", "message key", "ADR-0026", "accepted", "Your approval request {title} (round {roundNo}) was {outcome}.", "authored", "api workflows/approvals.ts"),
    ("approvals.task.escalated", "message key", "ADR-0026", "accepted", "Escalated to you: {title}, due {dueDate} (level {level}, from {fromParty} to {toParty}).", "authored", "worker handlers/approvals.ts"),
    ("approvals.task.overdue", "message key", "ADR-0026", "accepted", "{title} (round {roundNo}) is overdue since {dueDate} and was escalated to {escalatedToParty} (level {level}).", "authored", "worker handlers/approvals.ts"),
    ("approvals.task.overdue_routing_error", "message key", "ADR-0026", "accepted", "{title} (round {roundNo}) is overdue since {dueDate}, but it could not be escalated: {routingParty} has no mapped person ({routingError}).", "authored", "worker handlers/approvals.ts"),
    ("charter.decision_rights", "missing-item key", "ADR-0026", "accepted", "Charter decision rights", "authored", "api portfolio/readiness.ts (§9 readiness)"),
    # ---- ADR-0027 (KPI data model and pipeline)
    ("kpi_definition.archived", "422", "ADR-0027", "accepted", "Archived records are read-only.", "server", "api kpi/kpi-versions.ts, rag-thresholds.ts, trajectories.ts"),
    ("validation.period_label", "400 field", "ADR-0027", "accepted", "A period label starts with a letter or digit and uses letters, digits, '_', '.' and '-' (up to 32 characters).", "authored", "shared schemas/kpi-actuals.ts"),
    ("validation.trajectory_points_or_source", "400 field", "ADR-0027", "accepted", "Give either the trajectory points or the outcome KPI to copy them from, not both.", "authored", "shared schemas/kpi-versions.ts"),
    ("validation.trajectory_point_dates_distinct", "400 field", "ADR-0027", "accepted", "Each trajectory point needs its own date.", "authored", "shared schemas/kpi-versions.ts"),
    ("validation.variable_name", "400 field", "ADR-0027", "accepted", "A variable name starts with a lower-case letter and uses a-z, 0-9 and '_' (up to 48 characters).", "authored", "shared schemas/kpi-versions.ts, benefits.ts, benefit-values.ts"),
    ("kpi.update_due", "message key", "ADR-0027", "accepted", "Enter the {periodLabel} actual for {kpiName}.", "authored", "worker handlers/kpi.ts"),
    ("kpi_actual.review_due", "message key", "ADR-0027", "accepted", "Review the {periodLabel} actual of {kpiName} (value {valueNo}).", "authored", "api kpi/actuals.ts"),
    ("kpi_actual.rejected", "message key", "ADR-0027", "accepted", "The {periodLabel} actual of {kpiName} (value {valueNo}) was rejected. Correct it and submit again.", "authored", "api kpi/actuals.ts"),
    ("kpi.downstream.kpi_panel", "label key", "ADR-0027", "accepted", "KPI panel", "authored", "api kpi/downstream.ts"),
    ("kpi.downstream.formula_kpi", "label key", "ADR-0027", "accepted", "Formula KPI that reads this KPI", "authored", "api kpi/downstream.ts"),
    ("kpi.downstream.outcome_kpi", "label key", "ADR-0027", "accepted", "Outcome KPI", "authored", "api kpi/downstream.ts"),
    ("kpi.downstream.executive_overview_outcomes", "label key", "ADR-0027", "accepted", "Executive Overview: outcomes", "authored", "api kpi/downstream.ts"),
    # ---- ADR-0028 (KPI calculation semantics)
    ("kpi.aggregation_period_mismatch", "roll-up refusal", "ADR-0028", "accepted", "Roll-up refused: scope {scopeId} is for period {periodId} ({basis}), not {expectedPeriodId} ({expectedBasis}); a roll-up never mixes periods.", "server", "shared kpi/aggregate.ts"),
    ("kpi.before_trajectory", "reason key", "ADR-0028", "accepted", "Unknown: the date is before the first trajectory point.", "authored", "shared kpi/trajectory.ts; api kpi/kpi-status.ts"),
    ("kpi.no_approved_trajectory", "reason key", "ADR-0028", "accepted", "Unknown: the KPI has no approved target trajectory.", "authored", "shared kpi/trajectory.ts, rag.ts"),
    ("kpi.calculation_pending", "reason key", "ADR-0028", "accepted", "Unknown: an accepted actual is waiting for its calculation run.", "authored", "api kpi/kpi-status.ts; adoption/indicators.ts, gate-facts.ts"),
    ("kpi.value_out_of_range", "reason key", "ADR-0028", "accepted", "Not computable: the result does not fit the stored decimal range.", "authored", "shared kpi/types.ts, formula-binding.ts; worker handlers/kpi.ts"),
    # ---- ADR-0029 (benefit register, lifecycle, allocations)
    ("benefit_valuation_method.not_approved", "422", "ADR-0029", "accepted", "Only an approved valuation method can be retired.", "server", "api benefits/valuation-methods.ts"),
    ("benefit_value.period_range", "422", "ADR-0029", "accepted", "The period end cannot be before the period start.", "server", "api benefits/scenarios.ts, values.ts; db-errors.ts"),
    ("benefit_value.value_required", "422", "ADR-0029", "accepted", "A scenario value needs an amount or a KPI value.", "server", "api benefits/scenarios.ts, values.ts; db-errors.ts"),
    ("validation.decimal_share_scale", "400 field", "ADR-0029", "accepted", "A share has at most 6 decimal places.", "authored", "shared schemas/benefits.ts"),
    ("validation.key", "400 field", "ADR-0029", "accepted", "A key starts with a lower-case letter or digit and uses a-z, 0-9, '_', '.', ':' and '-' (up to 100 characters).", "authored", "shared schemas/benefits.ts"),
    ("validation.decimal_non_negative", "400 field", "ADR-0029", "accepted", "Enter zero or a positive amount.", "authored", "shared schemas/benefit-scenarios.ts"),
    ("benefits.task.overlap_review", "message key", "ADR-0029", "accepted", "Review a possible double count between {benefitACode} and {benefitBCode} ({dimensions}).", "authored", "api benefits/overlaps.ts"),
    ("benefit.planned_value_missing", "reason key", "ADR-0029", "accepted", "Unknown: the benefit has no planned value.", "authored", "api benefits/register.ts"),
    ("benefit.value_amount_missing", "reason key", "ADR-0029", "accepted", "Unknown: an amount in this total is missing.", "authored", "api benefits/register.ts, totals.ts"),
    ("benefit.kpi_actual_missing", "reason key", "ADR-0029", "accepted", "Unknown: the measuring KPI has no accepted actual.", "authored", "api benefits/register.ts"),
    ("benefit.non_financial", "reason key", "ADR-0029", "accepted", "Not applicable: a non-financial benefit has no currency amount.", "authored", "api reporting/dashboards/engine.ts"),
    ("benefit.not_counted", "reason key", "ADR-0029", "accepted", "Not applicable: this benefit is not counted in the total.", "authored", "api reporting/dashboards/engine.ts"),
    ("benefit.overlap_open", "reason key", "ADR-0029", "accepted", "Unknown: an open double-count warning excludes this benefit until it is resolved.", "authored", "api reporting/dashboards/engine.ts"),
    # ---- ADR-0030 (benefit values, Finance validation, totals)
    ("benefits.task.finance_validation_review", "message key", "ADR-0030", "accepted", "Validate the value of {benefitCode} for {periodStart} to {periodEnd}.", "authored", "worker handlers/benefits.ts"),
    ("kpi.downstream.benefit", "label key", "ADR-0030", "accepted", "Benefit measured by this KPI", "authored", "api benefits/downstream.ts"),
    # ---- ADR-0031 (RAID, actions, corrective cases)
    ("validation.not_applicable", "400 field", "ADR-0031, ADR-0033, ADR-0034", "accepted", "This field does not apply here.", "authored (RAID sends a per-field detail; BE-H2 sends the key)", "api raid/register.ts; adoption/assessments.ts; sustainment/handovers.ts"),
    ("raid.task.action_due", "message key", "ADR-0031", "accepted", "Your action is due. With {sourceCode}: Your action on {sourceCode} is due.", "authored", "api raid/actions.ts"),
    ("raid.task.corrective_follow_up", "message key", "ADR-0031", "accepted", "Follow up corrective case {caseCode}.", "authored", "api raid/corrective-cases.ts; worker handlers/raid.ts"),
    # ---- ADR-0032 (forums, meetings, T16, escalation)
    ("meeting.quorum_locked", "422", "ADR-0032", "accepted", "The quorum is set before the session starts; this meeting is {status}.", "server", "api governance/meetings.ts"),
    ("validation.user_unknown", "400 field", "ADR-0032", "accepted", "Choose an active user of this transformation's organization.", "server", "api governance/forums.ts (built as validation.${what}_unknown)"),
    ("validation.group_unknown", "400 field", "ADR-0032", "accepted", "Choose an active group of this transformation's organization.", "server", "api governance/forums.ts (built as validation.${what}_unknown)"),
    ("validation.forum_unknown", "400 field", "ADR-0032", "accepted", "Choose a forum of this transformation.", "server", "api governance/meetings.ts"),
    ("validation.end_before_start", "400 field", "ADR-0032", "accepted", "The end date cannot be before the start date.", "server", "api governance/meeting-series.ts"),
    ("validation.decision_right_unknown", "400 field", "ADR-0032", "accepted", "Choose an active decision-rights row of this transformation.", "server", "api governance/executive-decisions.ts"),
    ("validation.blocker_pair", "400 field", "ADR-0032", "accepted", "A blocker link names both its record type and its record.", "server", "api governance/executive-decisions.ts"),
    ("validation.empty_patch", "400 field", "ADR-0032", "accepted", "Change at least one field.", "authored", "shared schemas/governance-meetings.ts"),
    ("validation.local_time", "400 field", "ADR-0032", "accepted", "Enter a time as HH:MM (24-hour clock).", "authored", "shared schemas/governance-meetings.ts"),
    ("validation.option_label", "400 field", "ADR-0032", "accepted", "An option label is one capital letter, A to Z.", "authored", "shared schemas/executive-decisions.ts"),
    ("governance.task.executive_decision_due", "message key", "ADR-0032", "accepted", "Decide the executive ask {code}: {title}.", "authored", "api governance/executive-decisions.ts; worker handlers/escalations.ts"),
    ("governance.task.executive_decision_escalated", "message key", "ADR-0032", "accepted", "Escalated to you: executive ask {code} ({title}) passed its SLA date {slaDueDate} (level {level}).", "authored", "worker handlers/escalations.ts"),
    ("governance.notice.executive_decision_escalated", "notice key", "ADR-0032", "accepted", "The executive ask {code} ({title}) passed its SLA date {slaDueDate} and was escalated (level {level}).", "authored", "worker handlers/escalations.ts"),
    ("governance.notice.blocker_ask_calendar_not_configured", "notice key", "ADR-0032", "accepted", "A blocker has been red for {redCycles} cycles, but no executive ask was raised: the organization has no business calendar to set its SLA date.", "authored", "worker handlers/escalations.ts"),
    ("governance.notice.blocker_ask_owner_unassigned", "notice key", "ADR-0032", "accepted", "The executive ask {code} ({title}) has no owner: {partyCode} has no mapped person ({routingError}).", "authored", "worker handlers/escalations.ts"),
    ("governance.notice.series_calendar_not_configured", "notice key", "ADR-0032", "accepted", "No meetings were generated for this series: the organization has no business calendar for working days.", "authored", "worker handlers/meetings.ts"),
    # ---- ADR-0033 (adoption)
    ("validation.conflict", "400 field", "ADR-0033", "accepted", "Name an existing KPI or ask to create one, not both.", "authored", "shared schemas/adoption-indicators.ts"),
    ("adoption.task.intervention_due", "message key", "ADR-0033", "accepted", "Adoption intervention {code} is due.", "authored", "api adoption/interventions.ts; worker handlers/adoption.ts"),
    ("adoption.task.assessment_invitation", "message key", "ADR-0033", "accepted", "Please complete the form {formName}.", "authored", "api adoption/assessments.ts"),
    ("adoption.task.assessment_to_review", "message key", "ADR-0033", "accepted", "Review the submitted form {formName}.", "authored", "api adoption/assessments.ts"),
    ("adoption.no_reporting_period", "reason key", "ADR-0033", "accepted", "Unknown: the organization has no reporting period.", "authored", "api adoption/gate-facts.ts"),
    ("invalid_transition (existing code)", "422 detail", "ADR-0033", "accepted detail texts", "This champion is already removed. / A withdrawal record cannot itself be withdrawn. / This metric link is already removed.", "server", "api adoption/register.ts, indicators.ts"),
    ("validation.required (existing code)", "400 field", "ADR-0033", "accepted use", "at /reportingPeriodId when the organization has no open or closed period (getAdoptionIndicators)", "server", "api adoption/indicators.ts"),
    # ---- ADR-0034 (sustainment)
    ("sustainment.task.bau_handover_to_accept", "message key", "ADR-0034", "accepted", "Accept or return the BAU handover {handoverCode} for {areaCode} {areaName}.", "authored", "api sustainment/handovers.ts"),
    ("sustainment.task.performance_review_due", "message key", "ADR-0034", "accepted", "Review performance area {areaCode} by {dueDate}.", "authored", "api sustainment/performance-areas.ts; worker handlers/sustainment.ts"),
    ("sustainment.task.control_check_due", "message key", "ADR-0034", "accepted", "Run the control check {controlCode} by {dueDate}.", "authored", "worker handlers/sustainment.ts"),
    ("sustainment.task.benefit_monitoring_due", "message key", "ADR-0034", "accepted", "Monitor the residual benefit of transition decision {decisionCode} by {dueDate}.", "authored", "api sustainment/transition-decisions.ts; worker handlers/sustainment.ts"),
    # ---- ADR-0035 (phases, G5/G6, exceptions, routing)
    ("gate.exception_revoked", "422", "ADR-0035", "new (item 7; BE-R2 implements)", "The exception for {label} was revoked on {date}; it no longer covers the missing evidence.", "authored", "to be added to workflows/gates.ts"),
    ("forbidden (existing code)", "403 detail", "ADR-0035", "accepted detail text", "Only the requester can withdraw their exception.", "server", "api workflows/gate-exceptions.ts"),
    ("validation.duplicate_scope_item", "400 field", "ADR-0035", "accepted", "Each item can appear only once in the scale scope.", "authored", "shared schemas/gates-p4.ts"),
    ("gates.task.gate_decision_due", "message key", "ADR-0035", "accepted", "Decide gate {gateCode}, submission {submissionNo}.", "authored", "worker handlers/gates.ts"),
    ("gates.task.gate_condition_due", "message key", "ADR-0035", "accepted", "Meet condition {ordinal} of the {gateCode} decision.", "authored", "worker handlers/gates.ts"),
    ("gates.task.gate_exception_to_decide", "message key", "ADR-0035", "accepted", "Decide an exception for {criterionKey} at gate {gateCode} (expires {expiresOn}).", "authored", "api workflows/gate-exceptions.ts"),
    ("gates.task.gate_exception_expired", "message key", "ADR-0035", "accepted", "The exception for {criterionKey} at gate {gateCode} expired on {expiresOn}. Close the evidence gap.", "authored", "worker handlers/gates.ts"),
    ("gates.notice.gate_exception_expired", "notice key", "ADR-0035", "accepted", "The exception for {criterionKey} at gate {gateCode} expired on {expiresOn}; it no longer covers the missing evidence.", "authored", "worker handlers/gates.ts"),
    ("gates.task.phase_step_enabled", "message key", "ADR-0035", "accepted", "Phase step {stepKey} ({phaseCode}) can start.", "authored", "api workflows/phase-steps.ts; worker handlers/gates.ts"),
    ("gates.task.phase_step_review", "message key", "ADR-0035", "accepted", "Review phase step {stepKey} ({phaseCode}).", "authored", "api workflows/phase-steps.ts"),
    ("gates.task.scale_scope_enabled", "message key", "ADR-0035", "accepted", "Scale-out of {initiativeCode} is enabled in its approved scope.", "authored", "worker handlers/gates.ts"),
    ("g5.performance_not_loaded / g5.adoption_not_loaded / g5.risk_closure_not_loaded / g5.decision_log_not_loaded / g6.benefits_not_loaded / g6.ownership_not_loaded / g6.controls_not_loaded / g6.improvement_not_loaded", "missing-item key", "ADR-0035", "accepted", "{label}: the facts could not be read.", "server", "api workflows/g5.ts, g6.ts"),
    ("g5.performance_no_kpi", "missing-item key", "ADR-0035", "accepted", "Performance evidence: no KPI is linked to an outcome of the transformation.", "server", "api workflows/g5.ts"),
    ("g5.performance_no_accepted_actual", "missing-item key", "ADR-0035", "accepted", "Performance evidence: {name} has no accepted actual.", "server", "api workflows/g5.ts"),
    ("g5.performance_kpi_not_known", "missing-item key", "ADR-0035", "accepted", "Performance evidence: {name} is {valueStatus}.", "server", "api workflows/g5.ts"),
    ("g5.performance_pilot_evidence_missing", "missing-item key", "ADR-0035", "accepted", "Performance evidence: no verified evidence is linked to the Transform step \"deliver pilots\".", "server", "api workflows/g5.ts"),
    ("g5.adoption_none", "missing-item key", "ADR-0035", "accepted", "Adoption: no adoption indicator is linked to the transformation.", "server", "api workflows/g5.ts"),
    ("g5.adoption_indicator_unknown", "missing-item key", "ADR-0035", "accepted", "Adoption: indicator {templateKey} has no current value ({valueStatus}).", "server", "api workflows/g5.ts"),
    ("g5.risk_open", "missing-item key", "ADR-0035", "accepted", "Risk closure: {code} has High impact and is neither closed nor dispositioned.", "server", "api workflows/g5.ts"),
    ("g5.decision_log_empty", "missing-item key", "ADR-0035", "accepted", "Decision log: the T16 decision log has no entry.", "server", "api workflows/g5.ts"),
    ("g5.decision_date_missing", "missing-item key", "ADR-0035", "accepted", "Decision log: {name} is open and its decision date is missing.", "server", "api workflows/g5.ts"),
    ("g5.decision_overdue", "missing-item key", "ADR-0035", "accepted", "Decision log: {name} is open past its decision date {decisionDate}.", "server", "api workflows/g5.ts"),
    ("g6.benefits_none", "missing-item key", "ADR-0035", "accepted", "Benefits evidence: the transformation has no benefit.", "server", "api workflows/g6.ts"),
    ("g6.benefit_not_validated", "missing-item key", "ADR-0035", "accepted", "Benefits evidence: {code} {title} has no Finance-validated measurement and no approved transition decision.", "server", "api workflows/g6.ts"),
    ("g6.performance_area_none", "missing-item key", "ADR-0035", "accepted", "Ownership transfer: the transformation has no performance area.", "server", "api workflows/g6.ts"),
    ("g6.handover_not_accepted", "missing-item key", "ADR-0035", "accepted", "Ownership transfer: {code} {name} has no accepted BAU handover in its current cycle.", "server", "api workflows/g6.ts"),
    ("g6.controls_no_handover", "missing-item key", "ADR-0035", "accepted", "Controls: no performance area has an accepted BAU handover.", "server", "api workflows/g6.ts"),
    ("g6.control_missing", "missing-item key", "ADR-0035", "accepted", "Controls: {code} {name} has no active control.", "server", "api workflows/g6.ts"),
    ("g6.improvement_backlog_empty", "missing-item key", "ADR-0035", "accepted", "Continuous improvement backlog: the improvement backlog is empty.", "server", "api workflows/g6.ts"),
    # ---- ADR-0036 (change control)
    ("change_request.withdraw_via_approval", "422", "ADR-0036", "accepted until BE-R2, then retired (replaced by the in-transaction withdraw)", "This change request is in approval; withdraw its approval instead.", "server", "api workflows/change-requests.ts"),
    ("validation.proposed_change", "400 field", "ADR-0036", "accepted", "This proposed change does not fit the kind of change requested.", "authored", "shared schemas/change-control.ts"),
    ("validation.proposed_change_size", "400 field", "ADR-0036", "accepted", "A change request proposes between 1 and 20 changes.", "authored", "shared schemas/change-control.ts"),
    # ---- ADR-0037 (dashboards)
    ("validation.ratio_range", "400 field", "ADR-0037", "accepted", "Enter a decimal ratio from 0 to 1.", "authored", "shared schemas/dashboards.ts"),
    ("dashboard.rag.outcomes.trajectory", "rule key", "ADR-0037", "accepted", "Outcomes: the worst outcome-KPI status against its trajectory.", "authored", "api reporting/dashboards/areas.ts"),
    ("dashboard.rag.value.validated_gap", "rule key", "ADR-0037", "accepted", "Value: validated value against the value planned to date.", "authored", "api reporting/dashboards/areas.ts"),
    ("dashboard.rag.portfolio.milestone_outcome", "rule key", "ADR-0037", "accepted", "Portfolio: the worst milestone slip of the top initiatives.", "authored", "api reporting/dashboards/areas.ts"),
    ("dashboard.rag.dependencies.needed_by_critical_path", "rule key", "ADR-0037", "accepted", "Dependencies: open dependencies needed soon or on the critical path.", "authored", "api reporting/dashboards/areas.ts"),
    ("dashboard.rag.decisions.overdue", "rule key", "ADR-0037", "accepted", "Decisions: at least one open decision is past its decision date.", "authored", "api reporting/dashboards/areas.ts"),
    ("dashboard.rag.decisions.due", "rule key", "ADR-0037", "accepted", "Decisions: open decisions are due soon.", "authored", "api reporting/dashboards/areas.ts"),
    ("dashboard.rag.adoption.curve", "rule key", "ADR-0037", "accepted", "People and adoption: the worst adoption indicator against its curve.", "authored", "api reporting/dashboards/areas.ts"),
    ("dashboard.value.gap_ratio", "rule key", "ADR-0037", "accepted", "Value gap = (planned due to date - validated) / planned due to date.", "authored", "api reporting/dashboards/drilldown.ts"),
    ("dashboard.value.sum_investment", "rule key", "ADR-0037", "accepted", "Investment = the sum of the approved budget lines.", "authored", "api reporting/dashboards/drilldown.ts"),
    ("dashboard.finance.pending_validation", "rule key", "ADR-0037", "accepted", "Values waiting for Finance validation.", "authored", "api reporting/dashboards/drilldown.ts"),
    ("dashboard.value.nothing_planned", "reason key", "ADR-0037", "accepted", "Not applicable: nothing is planned to date.", "authored", "api reporting/dashboards/areas.ts, drilldown.ts, engine.ts"),
    ("dashboard.value.no_financial_benefit", "reason key", "ADR-0037", "accepted", "Not applicable: there is no financial benefit.", "authored", "api reporting/dashboards/drilldown.ts, engine.ts"),
    ("dashboard.value.multiple_currencies", "reason key", "ADR-0037", "accepted", "Not applicable: the values are in more than one currency and are never converted.", "authored", "api reporting/dashboards/drilldown.ts"),
    ("dashboard.portfolio.no_allocated_value", "reason key", "ADR-0037", "accepted", "Unknown: no benefit value is allocated to this initiative.", "authored", "api reporting/dashboards/drilldown.ts, engine.ts"),
    ("dashboard.portfolio.no_approved_milestone", "reason key", "ADR-0037", "accepted", "Unknown: the initiative has no approved milestone date.", "authored", "api reporting/dashboards/areas.ts"),
    ("dashboard.portfolio.milestone_overdue", "reason key", "ADR-0037", "accepted", "Red: a milestone is past its approved date and not achieved.", "authored", "api reporting/dashboards/areas.ts"),
    ("dashboard.portfolio.milestone_slip", "reason key", "ADR-0037", "accepted", "A milestone has slipped past its approved date.", "authored", "api reporting/dashboards/areas.ts"),
    ("dashboard.kpi.no_period_in_window", "reason key", "ADR-0037", "accepted", "Unknown: no reporting period falls in the selected window.", "authored", "api kpi/dashboard-facts.ts"),
    ("dashboard.headline.value_planned", "label key", "ADR-0037", "accepted", "Planned value", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.value_forecast", "label key", "ADR-0037", "accepted", "Forecast value", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.value_submitted", "label key", "ADR-0037", "accepted", "Submitted value", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.value_validated", "label key", "ADR-0037", "accepted", "Validated value", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.value_gap", "label key", "ADR-0037", "accepted", "Value gap", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.value_investment", "label key", "ADR-0037", "accepted", "Investment", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.outcome_kpis", "label key", "ADR-0037", "accepted", "Outcome KPIs", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.top_initiatives", "label key", "ADR-0037", "accepted", "Top initiatives", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.open_dependencies", "label key", "ADR-0037", "accepted", "Open dependencies", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.open_decisions", "label key", "ADR-0037", "accepted", "Open decisions", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.overdue_decisions", "label key", "ADR-0037", "accepted", "Overdue decisions", "authored", "api reporting/dashboards/engine.ts"),
    ("dashboard.headline.adoption_indicators", "label key", "ADR-0037", "accepted", "Adoption indicators", "authored", "api reporting/dashboards/engine.ts"),
    # ---- ADR-0038 (traceability)
    ("validation.basis_needs_share", "400 field", "ADR-0038", "accepted", "An allocation basis needs a share.", "server", "api portfolio/links.ts; reporting/traceability.ts"),
    ("validation.share_range", "400 field", "ADR-0038", "accepted", "A share is more than 0 and at most 1 (100 %).", "authored", "shared schemas/traceability.ts"),
    ("validation.decimal_measure_scale", "400 field", "ADR-0038", "accepted", "Enter a decimal with at most 6 decimal places.", "authored", "shared schemas/kpi.ts columnDecimal (SHARE_COLUMN is named 'measure')"),
    ("validation.root_pair", "400 field", "ADR-0038", "accepted", "Give rootType and rootId together.", "authored", "shared schemas/traceability.ts (api reporting/traceability.ts)"),
    ("trace_link.record_not_found (existing ADR-0038 §12 code)", "422", "ADR-0038", "accepted reuse", "on a getTraceability root that is not a record of that type in the transformation (the §12 text)", "server", "api reporting/traceability.ts"),
]

def esc(s):
    return s.replace("|", "\\|")

if __name__ == "__main__":
    import sys
    adr = sys.argv[1] if len(sys.argv) > 1 else None
    rows = [r for r in ROWS if adr is None or adr in r[2]]
    if adr is None:
        print("| # | Code or key | Kind | Owning ADR | Decision | English text | Text origin | Where |")
        print("|---|---|---|---|---|---|---|---|")
        for i, r in enumerate(rows, 1):
            print(f"| {i} | `{esc(r[0])}` | {r[1]} | {r[2]} | {r[3]} | {esc(r[4])} | {r[5]} | {esc(r[6])} |")
    else:
        print("| Code or key | Kind | Decision | English text (exact) |")
        print("|---|---|---|---|")
        for r in rows:
            print(f"| `{esc(r[0])}` | {r[1]} | {r[3]} | {esc(r[4])} |")
