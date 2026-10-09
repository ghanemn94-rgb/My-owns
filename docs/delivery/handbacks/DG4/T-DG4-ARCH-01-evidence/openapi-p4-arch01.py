#!/usr/bin/env python3
"""T-DG4-ARCH-01: generates the slice I + C OpenAPI additions (ADR-0025, ADR-0026) and inserts them into
docs/api/openapi.yaml. Provenance only: run once by the solution-architect; the YAML file is the contract.

  python3 docs/delivery/handbacks/DG4/T-DG4-ARCH-01-evidence/openapi-p4-arch01.py docs/api/openapi.yaml

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


# ----------------------------------------------------------------------------------------------- calendar (ADR-0025 §1)
op("/api/v1/organizations/{organizationId}/calendars", "get", "listBusinessCalendars", "calendar",
   "Business calendars of the organization (organization.read). The default calendar is Asia/Riyadh with a Sunday-Thursday workweek and no holiday until one is configured (REQ-S10-006).",
   params=["OrganizationId"], query=["Cursor", "Limit"], ok_schema="BusinessCalendarPage", forbidden=False, rule=False)
op("/api/v1/organizations/{organizationId}/calendars", "post", "createBusinessCalendar", "calendar",
   "Create a calendar (calendar.configure; ADM_TECH). 422 calendar.workweek_invalid, calendar.timezone_unknown; 409 calendar.code_taken.",
   params=["OrganizationId"], body="BusinessCalendarCreate", ok="201", ok_desc="Created.", ok_schema="BusinessCalendar",
   etag=True, location=True, dup=True)
op("/api/v1/calendars/{calendarId}", "get", "getBusinessCalendar", "calendar", "Read one calendar (organization.read).",
   params=["CalendarId"], ok_schema="BusinessCalendar", etag=True, forbidden=False, rule=False)
op("/api/v1/calendars/{calendarId}", "patch", "updateBusinessCalendar", "calendar",
   "Change names, timezone, workweek, default flag or status (calendar.configure). Stored due dates are not recomputed (ADR-0025 §1). 422 calendar.default_not_archivable.",
   params=["CalendarId"], body="BusinessCalendarUpdate", ok_schema="BusinessCalendar", etag=True, if_match=True)
op("/api/v1/calendars/{calendarId}/holidays", "get", "listCalendarHolidays", "calendar",
   "Administered holidays of the calendar, by start date (organization.read). None is seeded.",
   params=["CalendarId"], query=["Cursor", "Limit", "HolidayYear"], ok_schema="CalendarHolidayPage", forbidden=False, rule=False)
op("/api/v1/calendars/{calendarId}/holidays", "post", "createCalendarHoliday", "calendar",
   "Add a holiday (inclusive range, at most 31 days; calendar.configure). 422 calendar.holiday_range_invalid.",
   params=["CalendarId"], body="CalendarHolidayCreate", ok="201", ok_desc="Created.", ok_schema="CalendarHoliday", etag=True, location=True)
op("/api/v1/calendars/{calendarId}/holidays/{holidayId}", "patch", "updateCalendarHoliday", "calendar",
   "Change or remove (status removed) a holiday (calendar.configure). Never deleted.",
   params=["CalendarId", "HolidayId"], body="CalendarHolidayUpdate", ok_schema="CalendarHoliday", etag=True, if_match=True)
op("/api/v1/calendars/{calendarId}/working-days", "get", "computeWorkingDayDueDate", "calendar",
   "The n-th working day strictly after a business date (ADR-0025 §1). dueDate is null with unknownReason when it cannot be computed; never elapsed calendar days.",
   params=["CalendarId"], query=["FromDate", "WorkingDays"], ok_schema="WorkingDayComputation", forbidden=False, rule=False)

# ----------------------------------------------------------------------------------------------- jobs (ADR-0025 §3)
op("/api/v1/admin/job-schedules", "get", "listJobSchedules", "jobs",
   "Recurring jobs of the scheduled-job kit (job.read; ADM_TECH).", query=["Cursor", "Limit"], ok_schema="JobSchedulePage",
   not_found=False, rule=False)
op("/api/v1/admin/job-schedules/{jobCode}", "patch", "updateJobSchedule", "jobs",
   "Enable, disable or reschedule a job (job.configure; ADM_TECH). 422 job.cron_invalid, job.timezone_unknown.",
   params=["JobCode"], body="JobScheduleUpdate", ok_schema="JobSchedule", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- tasks (ADR-0025 §4)
op("/api/v1/me/work-items", "get", "listMyWorkItems", "tasks",
   "The caller's own My Work items (open first by due date). No other person's items are ever listed.",
   query=["Cursor", "Limit", "WorkItemStatus", "WorkItemKind", "TransformationIdQuery"], ok_schema="WorkItemPage",
   forbidden=False, not_found=False, rule=False)
op("/api/v1/work-items/{workItemId}", "get", "getWorkItem", "tasks", "Read one of the caller's work items (others: 404).",
   params=["WorkItemId"], ok_schema="WorkItem", etag=True, forbidden=False, rule=False)
op("/api/v1/work-items/{workItemId}/complete", "post", "completeWorkItem", "tasks",
   "Mark the caller's task done. 403 work_item.not_assignee; 422 work_item.closed, work_item.system_managed (approval tasks close with their approval).",
   params=["WorkItemId"], ok_schema="WorkItem", etag=True, if_match=True)
op("/api/v1/me/inbox", "get", "listMyInbox", "tasks", "The caller's in-app reminders, newest first, with the unread count.",
   query=["Cursor", "Limit", "UnreadOnly"], ok_schema="InboxPage", forbidden=False, not_found=False, rule=False)
op("/api/v1/me/inbox/{notificationId}/read", "post", "markInboxNotificationRead", "tasks",
   "Mark one of the caller's reminders as read (once). 422 inbox.already_read.",
   params=["NotificationId"], ok_schema="InboxNotification", etag=True, if_match=True, forbidden=False)

# ----------------------------------------------------------------------------------------------- groups (ADR-0026 §1)
op("/api/v1/organizations/{organizationId}/groups", "get", "listGroups", "groups",
   "Governed groups of the organization (organization.read). A group is a routing target and grants no permission.",
   params=["OrganizationId"], query=["Cursor", "Limit"], ok_schema="GroupPage", forbidden=False, rule=False)
op("/api/v1/organizations/{organizationId}/groups", "post", "createGroup", "groups", "Create a governed group (group.manage; TO). 409 group.code_taken.",
   params=["OrganizationId"], body="GroupCreate", ok="201", ok_desc="Created.", ok_schema="Group", etag=True, location=True, dup=True)
op("/api/v1/groups/{groupId}", "get", "getGroup", "groups", "Read one group (organization.read).",
   params=["GroupId"], ok_schema="Group", etag=True, forbidden=False, rule=False)
op("/api/v1/groups/{groupId}", "patch", "updateGroup", "groups", "Rename, change owner, archive (group.manage).",
   params=["GroupId"], body="GroupUpdate", ok_schema="Group", etag=True, if_match=True)
op("/api/v1/groups/{groupId}/members", "get", "listGroupMembers", "groups", "Members, current first (organization.read).",
   params=["GroupId"], query=["Cursor", "Limit"], ok_schema="GroupMemberPage", forbidden=False, rule=False)
op("/api/v1/groups/{groupId}/members", "post", "addGroupMember", "groups",
   "Add a member of the same organization (group.manage). 409 group.member_exists; 422 group.member_other_organization.",
   params=["GroupId"], body="GroupMemberCreate", ok="201", ok_desc="Added.", ok_schema="GroupMember", etag=True, location=True, dup=True)
op("/api/v1/groups/{groupId}/members/{memberId}/remove", "post", "removeGroupMember", "groups",
   "Remove a member with a reason (group.manage). The row stays as history.",
   params=["GroupId", "MemberId"], body="ReasonRequest", ok_schema="GroupMember", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- role mappings (ADR-0026 §2)
op("/api/v1/governance-parties", "get", "listGovernanceParties", "role-mappings",
   "The parties named by T11 (B0099) and T12 (B0101), seeded and read-only.", ok_schema="GovernancePartyList",
   forbidden=False, not_found=False, rule=False)
op("/api/v1/transformations/{transformationId}/role-mappings", "get", "listRoleMappings", "role-mappings",
   "Who each party is in this transformation: a named person or a governed group (transformation.read).",
   params=["TransformationId"], query=["Cursor", "Limit", "RoleMappingStatus"], ok_schema="RoleMappingPage", forbidden=False, rule=False)
op("/api/v1/transformations/{transformationId}/role-mappings", "post", "createRoleMapping", "role-mappings",
   "Map a party to a person or a group (role_mapping.assign; TL, TO). 409 role_mapping.already_mapped (end the current mapping first).",
   params=["TransformationId"], body="RoleMappingCreate", ok="201", ok_desc="Created.", ok_schema="RoleMapping", etag=True, location=True, dup=True)
op("/api/v1/transformations/{transformationId}/role-mappings/{mappingId}/end", "post", "endRoleMapping", "role-mappings",
   "End a mapping with a reason (role_mapping.assign). Final; map again with a new mapping.",
   params=["TransformationId", "MappingId"], body="ReasonRequest", ok_schema="RoleMapping", etag=True, if_match=True)
op("/api/v1/transformations/{transformationId}/role-mappings/resolve", "get", "resolveGovernanceParty", "role-mappings",
   "Resolve a party for routing. An unmapped party is reported as status unmapped (no fallback); routing itself refuses with 422 routing.role_unmapped.",
   params=["TransformationId"], query=["PartyQuery"], ok_schema="PartyResolution", forbidden=False, rule=False)

# ----------------------------------------------------------------------------------------------- delegations (ADR-0026 §3)
op("/api/v1/delegations", "get", "listDelegations", "delegations",
   "Delegations where the caller is delegator or delegate; with delegation.manage, every delegation of the caller's organization.",
   query=["Cursor", "Limit", "DelegationRole", "DelegationStatus"], ok_schema="DelegationPage", forbidden=False, not_found=False, rule=False)
op("/api/v1/delegations", "post", "createDelegation", "delegations",
   "Delegate for a period (delegation.create_own for yourself; delegation.manage on the delegator's request). 422 delegation.loop, delegation.self, delegation.window_invalid, delegation.delegate_is_requester, delegation.admin_self; 403 delegation.not_delegator.",
   body="DelegationCreate", ok="201", ok_desc="Created.", ok_schema="Delegation", etag=True, location=True, not_found=False)
op("/api/v1/delegations/{delegationId}", "get", "getDelegation", "delegations", "Read one delegation (delegator, delegate or delegation.manage; others 404).",
   params=["DelegationId"], ok_schema="Delegation", etag=True, forbidden=False, rule=False)
op("/api/v1/delegations/{delegationId}/revoke", "post", "revokeDelegation", "delegations",
   "Revoke with a reason (the delegator, or delegation.manage). 422 delegation.not_active.",
   params=["DelegationId"], body="ReasonRequest", ok_schema="Delegation", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- approvals (ADR-0026 §4, §6)
op("/api/v1/approvals", "get", "listMyApprovals", "approvals",
   "Approvals assigned to the caller, their groups, escalated to them or to people they act for (role=assignee), or requested by them (role=requester).",
   query=["Cursor", "Limit", "ApprovalRole", "ApprovalStatus", "TransformationIdQuery"], ok_schema="ApprovalPage",
   forbidden=False, not_found=False, rule=False)
op("/api/v1/transformations/{transformationId}/approvals", "post", "requestApproval", "approvals",
   "Request a decision routed by the T11 matrix (approval.request). The assignee is the person or group mapped to the row's Approve party; the due date follows its SLA type. 422 routing.role_unmapped, decision_right.urgent_not_configured, decision_right.urgent_reason_required; 409 approval.already_open.",
   params=["TransformationId"], body="ApprovalRequest", ok="201", ok_desc="Requested (pending).", ok_schema="Approval", etag=True, location=True, dup=True)
op("/api/v1/approvals/{approvalId}", "get", "getApproval", "approvals",
   "Read one approval with its decisions and escalations (transformation.read).",
   params=["ApprovalId"], ok_schema="Approval", etag=True, forbidden=False, rule=False)
op("/api/v1/approvals/{approvalId}/decisions", "post", "decideApproval", "approvals",
   "Approve, reject, request changes or defer (approval.decide and assigned). 403 approval.not_assignee, approval.sod_requester; 409 approval.stale_version (subjectVersion is not the record's current version) or If-Match; 422 approval.not_open, approval.rationale_required, approval.defer_date_required. A timer never calls this.",
   params=["ApprovalId"], body="ApprovalDecisionCreate", ok_schema="Approval", etag=True, if_match=True)
op("/api/v1/approvals/{approvalId}/resubmit", "post", "resubmitApproval", "approvals",
   "After 'request changes': resubmit a newer version of the record (the requester). 403 approval.not_requester; 422 approval.resubmit_needs_new_version.",
   params=["ApprovalId"], body="ApprovalResubmit", ok_schema="Approval", etag=True, if_match=True)
op("/api/v1/approvals/{approvalId}/withdraw", "post", "withdrawApproval", "approvals",
   "Withdraw an open request with a reason (the requester). Final.",
   params=["ApprovalId"], body="ReasonRequest", ok_schema="Approval", etag=True, if_match=True)
op("/api/v1/transformations/{transformationId}/approval-decisions", "get", "listApprovalDecisionRecords", "approvals",
   "Read-only union of the transformation's business-approval decisions: P4 approvals, product-gate decisions (G1-G6) and funding decisions (D-089 Q10).",
   params=["TransformationId"], query=["Cursor", "Limit"], ok_schema="ApprovalDecisionRecordPage", forbidden=False, rule=False)

# ----------------------------------------------------------------------------------------------- T11 (ADR-0026 §5)
op("/api/v1/decision-right-templates", "get", "listDecisionRightTemplates", "decision-rights",
   "The four T11 rows of B0099, verbatim (read-only).", ok_schema="DecisionRightTemplateList", forbidden=False, not_found=False, rule=False)
op("/api/v1/transformations/{transformationId}/decision-rights", "get", "listDecisionRights", "decision-rights",
   "The transformation's T11 matrix: the four seeded rows (copied verbatim) and added rows (transformation.read).",
   params=["TransformationId"], query=["Cursor", "Limit"], ok_schema="DecisionRightPage", forbidden=False, rule=False)
op("/api/v1/transformations/{transformationId}/decision-rights", "post", "createDecisionRight", "decision-rights",
   "Add a row (decision_right.configure; TO, TL). 422 decision_right.party_unknown, decision_right.sla_invalid, governance_matrix.in_approval.",
   params=["TransformationId"], body="DecisionRightCreate", ok="201", ok_desc="Created.", ok_schema="DecisionRight", etag=True, location=True)
op("/api/v1/transformations/{transformationId}/decision-rights/{decisionRightId}", "get", "getDecisionRight", "decision-rights",
   "Read one T11 row.", params=["TransformationId", "DecisionRightId"], ok_schema="DecisionRight", etag=True, forbidden=False, rule=False)
op("/api/v1/transformations/{transformationId}/decision-rights/{decisionRightId}", "patch", "updateDecisionRight", "decision-rights",
   "Edit the transformation's copy of a row (decision_right.configure). The seeded template never changes. 422 decision_right.party_unknown, decision_right.sla_invalid, governance_matrix.in_approval.",
   params=["TransformationId", "DecisionRightId"], body="DecisionRightUpdate", ok_schema="DecisionRight", etag=True, if_match=True)
op("/api/v1/transformations/{transformationId}/decision-rights/{decisionRightId}/due-date", "get", "previewDecisionRightDueDate", "decision-rights",
   "The due date a request raised on a business date would get under the row's SLA type (working days, next SteerCo or urgent route, release plan). Unknown is null with a reason.",
   params=["TransformationId", "DecisionRightId"], query=["RaisedOn", "Urgent", "ReleaseMilestoneId"], ok_schema="DueDatePreview", forbidden=False)

# ----------------------------------------------------------------------------------------------- T12 and matrices (ADR-0026 §7, §9)
op("/api/v1/raci-template", "get", "getRaciTemplate", "raci", "The six T12 deliverables of B0101 with their cells, verbatim (read-only).",
   ok_schema="RaciTemplate", forbidden=False, not_found=False, rule=False)
op("/api/v1/transformations/{transformationId}/raci", "get", "getTransformationRaci", "raci",
   "The transformation's T12 RACI with its matrix status (transformation.read).", params=["TransformationId"], ok_schema="Raci",
   forbidden=False, rule=False)
op("/api/v1/transformations/{transformationId}/raci/deliverables", "post", "createRaciDeliverable", "raci",
   "Add a deliverable with its cells (raci.edit; TO, TL). 422 raci.invalid_value, raci.accountable_count, governance_matrix.in_approval.",
   params=["TransformationId"], body="RaciDeliverableCreate", ok="201", ok_desc="Created.", ok_schema="RaciDeliverable", etag=True, location=True)
op("/api/v1/transformations/{transformationId}/raci/deliverables/{deliverableId}", "patch", "updateRaciDeliverable", "raci",
   "Edit a deliverable and save its cells as one change (raci.edit). A, R, C, I or A/R; exactly one accountable (A/R counts as one) unless an accountability exception is documented. 422 raci.invalid_value, raci.accountable_count, governance_matrix.in_approval.",
   params=["TransformationId", "DeliverableId"], body="RaciDeliverableUpdate", ok_schema="RaciDeliverable", etag=True, if_match=True)
op("/api/v1/transformations/{transformationId}/governance-matrices", "get", "listGovernanceMatrices", "raci",
   "Approval state of the T11 and T12 matrices (transformation.read).", params=["TransformationId"], ok_schema="GovernanceMatrixList",
   forbidden=False, rule=False)
op("/api/v1/transformations/{transformationId}/governance-matrices/{matrixKind}/submit", "post", "submitGovernanceMatrix", "raci",
   "Submit the matrix's current version for the Sponsor's approval (decision_right.configure for T11, raci.edit for T12). Rows freeze while in approval. 422 governance_matrix.not_draft, routing.role_unmapped.",
   params=["TransformationId", "MatrixKind"], body="GovernanceMatrixSubmit", ok="201", ok_desc="Approval requested.", ok_schema="Approval",
   etag=True, location=True, if_match=True)
op("/api/v1/transformations/{transformationId}/readiness/transform", "get", "getTransformReadiness", "raci",
   "Operating model before execution (REQ-PB-008, B0013): Transform readiness from the charter decision rights, the four seeded T11 rows and their mapped approvers, and one accountable per T12 deliverable. The DG3 readiness operation is unchanged.",
   params=["TransformationId"], ok_schema="TransformReadiness", forbidden=False, rule=False)


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
    "CalendarId": ("calendarId", "path", UUID),
    "HolidayId": ("holidayId", "path", UUID),
    "JobCode": ("jobCode", "path", '{ type: string, pattern: "^[a-z_]+\\\\.[a-z_]+$", maxLength: 64 }'),
    "WorkItemId": ("workItemId", "path", UUID),
    "NotificationId": ("notificationId", "path", UUID),
    "GroupId": ("groupId", "path", UUID),
    "MemberId": ("memberId", "path", UUID),
    "MappingId": ("mappingId", "path", UUID),
    "DelegationId": ("delegationId", "path", UUID),
    "ApprovalId": ("approvalId", "path", UUID),
    "DecisionRightId": ("decisionRightId", "path", UUID),
    "MatrixKind": ("matrixKind", "path", "{ type: string, enum: [decision_rights, raci] }"),
    "HolidayYear": ("year", "query", "{ type: integer, minimum: 2000, maximum: 2100 }"),
    "FromDate": ("from", "query", '{ $ref: "#/components/schemas/BusinessDate" }', True),
    "WorkingDays": ("workingDays", "query", "{ type: integer, minimum: 1, maximum: 250 }", True),
    "WorkItemStatus": ("status", "query", "{ type: string, enum: [open, done, cancelled] }"),
    "WorkItemKind": ("kind", "query", '{ type: string, pattern: "^[a-z_]+$", maxLength: 64 }'),
    "TransformationIdQuery": ("transformationId", "query", UUID),
    "UnreadOnly": ("unreadOnly", "query", "{ type: boolean, default: false }"),
    "RoleMappingStatus": ("status", "query", "{ type: string, enum: [active, ended] }"),
    "PartyQuery": ("party", "query", '{ $ref: "#/components/schemas/PartyCode" }', True),
    "DelegationRole": ("role", "query", "{ type: string, enum: [delegator, delegate, any], default: any }"),
    "DelegationStatus": ("status", "query", "{ type: string, enum: [active, revoked, expired] }"),
    "ApprovalRole": ("role", "query", "{ type: string, enum: [assignee, requester], default: assignee }"),
    "ApprovalStatus": ("status", "query", "{ type: string, enum: [pending, changes_requested, deferred, approved, rejected, withdrawn] }"),
    "RaisedOn": ("raisedOn", "query", '{ $ref: "#/components/schemas/BusinessDate" }', True),
    "Urgent": ("urgent", "query", "{ type: boolean, default: false }"),
    "ReleaseMilestoneId": ("releaseMilestoneId", "query", UUID),
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


SCHEMAS = r'''
    # ---- P4 slices I and C (T-DG4-ARCH-01; ADR-0025, ADR-0026) ------------------------------------------------
    PartyCode:
      type: string
      pattern: "^[A-Z][A-Z0-9_]{0,31}$"
      description: A governance party code (governance_party), e.g. SP, BO, STEERCO.
    Weekday:
      type: integer
      minimum: 1
      maximum: 7
      description: ISO weekday, 1 = Monday ... 7 = Sunday.
    LocalizedLabel:
      type: string
      minLength: 1
      maxLength: 300
    BusinessCalendar:
      type: object
      required: [id, organizationId, code, nameEn, nameAr, timezone, workweek, isDefault, status, version, createdAt, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        organizationId: { $ref: "#/components/schemas/Uuid" }
        code: { $ref: "#/components/schemas/Code" }
        nameEn: { $ref: "#/components/schemas/Name" }
        nameAr: { $ref: "#/components/schemas/Name" }
        timezone: { $ref: "#/components/schemas/TimeZone" }
        workweek: { type: array, minItems: 1, maxItems: 7, uniqueItems: true, items: { $ref: "#/components/schemas/Weekday" } }
        isDefault: { type: boolean }
        status: { type: string, enum: [active, archived] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    BusinessCalendarCreate:
      type: object
      required: [code, nameEn, nameAr]
      additionalProperties: false
      properties:
        code: { $ref: "#/components/schemas/Code" }
        nameEn: { $ref: "#/components/schemas/Name" }
        nameAr: { $ref: "#/components/schemas/Name" }
        timezone: { $ref: "#/components/schemas/TimeZone" }
        workweek: { type: array, minItems: 1, maxItems: 7, items: { type: integer } }
        isDefault: { type: boolean }
    BusinessCalendarUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        nameEn: { $ref: "#/components/schemas/Name" }
        nameAr: { $ref: "#/components/schemas/Name" }
        timezone: { $ref: "#/components/schemas/TimeZone" }
        workweek: { type: array, minItems: 1, maxItems: 7, items: { type: integer } }
        isDefault: { type: boolean, const: true, description: "Make this the default; the previous default stops being default in the same change." }
        status: { type: string, enum: [active, archived] }
    BusinessCalendarPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/BusinessCalendar" } }
        nextCursor: { type: [string, "null"] }
    CalendarHoliday:
      type: object
      required: [id, calendarId, dateFrom, dateTo, nameEn, nameAr, status, version, createdAt, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        calendarId: { $ref: "#/components/schemas/Uuid" }
        dateFrom: { $ref: "#/components/schemas/BusinessDate" }
        dateTo: { $ref: "#/components/schemas/BusinessDate" }
        nameEn: { $ref: "#/components/schemas/Name" }
        nameAr: { $ref: "#/components/schemas/Name" }
        status: { type: string, enum: [active, removed] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    CalendarHolidayCreate:
      type: object
      required: [dateFrom, dateTo, nameEn, nameAr]
      additionalProperties: false
      properties:
        dateFrom: { $ref: "#/components/schemas/BusinessDate" }
        dateTo: { $ref: "#/components/schemas/BusinessDate" }
        nameEn: { $ref: "#/components/schemas/Name" }
        nameAr: { $ref: "#/components/schemas/Name" }
    CalendarHolidayUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        dateFrom: { $ref: "#/components/schemas/BusinessDate" }
        dateTo: { $ref: "#/components/schemas/BusinessDate" }
        nameEn: { $ref: "#/components/schemas/Name" }
        nameAr: { $ref: "#/components/schemas/Name" }
        status: { type: string, enum: [active, removed] }
    CalendarHolidayPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/CalendarHoliday" } }
        nextCursor: { type: [string, "null"] }
    WorkingDayComputation:
      type: object
      required: [calendarId, calendarVersion, from, workingDays, dueDate, unknownReason, skippedDates]
      additionalProperties: false
      properties:
        calendarId: { $ref: "#/components/schemas/Uuid" }
        calendarVersion: { $ref: "#/components/schemas/Version" }
        from: { $ref: "#/components/schemas/BusinessDate" }
        workingDays: { type: integer, minimum: 1, maximum: 250 }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        unknownReason: { type: [string, "null"], enum: [calendar_not_configured, null] }
        skippedDates:
          type: array
          description: Non-working dates passed over (weekend days and holidays), in order.
          items:
            type: object
            required: [date, reason]
            additionalProperties: false
            properties:
              date: { $ref: "#/components/schemas/BusinessDate" }
              reason: { type: string, enum: [weekend, holiday] }
              holidayId: { $ref: "#/components/schemas/NullableUuid" }
    JobSchedule:
      type: object
      required: [code, queueName, cron, timezone, enabled, descriptionEn, descriptionAr, ownerModule, version, updatedAt]
      additionalProperties: false
      properties:
        code: { type: string }
        queueName: { type: string }
        cron: { type: string }
        timezone: { $ref: "#/components/schemas/TimeZone" }
        enabled: { type: boolean }
        descriptionEn: { type: string }
        descriptionAr: { type: string }
        ownerModule: { type: string }
        version: { $ref: "#/components/schemas/Version" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    JobScheduleUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        enabled: { type: boolean }
        cron: { type: string, minLength: 9, maxLength: 100 }
        timezone: { $ref: "#/components/schemas/TimeZone" }
    JobSchedulePage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/JobSchedule" } }
        nextCursor: { type: [string, "null"] }
    WorkItem:
      type: object
      required: [id, organizationId, transformationId, kind, assigneeUserId, subjectType, subjectId, linkPath, messageKey, messageParams, dueDate, periodLabel, status, completedAt, completedBy, createdAt, version]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        organizationId: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/NullableUuid" }
        kind: { type: string, description: "A work_item_kind code (e.g. kpi_update_due, approval_decision)." }
        assigneeUserId: { $ref: "#/components/schemas/Uuid" }
        subjectType: { type: string }
        subjectId: { $ref: "#/components/schemas/Uuid" }
        linkPath: { type: string, pattern: "^/[^/\\\\]", description: "Relative in-app link." }
        messageKey: { type: string, description: "i18n key; the client translates it at render time." }
        messageParams: { type: object, additionalProperties: { type: [string, number, boolean, "null"] } }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        periodLabel: { type: [string, "null"] }
        status: { type: string, enum: [open, done, cancelled] }
        completedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        completedBy: { $ref: "#/components/schemas/NullableUuid" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        version: { $ref: "#/components/schemas/Version" }
    WorkItemPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/WorkItem" } }
        nextCursor: { type: [string, "null"] }
    InboxNotification:
      type: object
      required: [id, transformationId, workItemId, linkPath, messageKey, messageParams, readAt, createdAt, version]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/NullableUuid" }
        workItemId: { $ref: "#/components/schemas/NullableUuid" }
        linkPath: { type: string, pattern: "^/[^/\\\\]" }
        messageKey: { type: string }
        messageParams: { type: object, additionalProperties: { type: [string, number, boolean, "null"] } }
        readAt: { $ref: "#/components/schemas/NullableTimestamp" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        version: { $ref: "#/components/schemas/Version" }
    InboxPage:
      type: object
      required: [items, nextCursor, unreadCount]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/InboxNotification" } }
        nextCursor: { type: [string, "null"] }
        unreadCount: { type: integer, minimum: 0 }
    Group:
      type: object
      required: [id, organizationId, code, nameEn, nameAr, description, ownerUserId, status, memberCount, version, createdAt, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        organizationId: { $ref: "#/components/schemas/Uuid" }
        code: { $ref: "#/components/schemas/Code" }
        nameEn: { $ref: "#/components/schemas/Name" }
        nameAr: { $ref: "#/components/schemas/Name" }
        description: { type: [string, "null"], maxLength: 2000 }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        status: { type: string, enum: [active, archived] }
        memberCount: { type: integer, minimum: 0, description: "Current members." }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    GroupCreate:
      type: object
      required: [code, nameEn, nameAr, ownerUserId]
      additionalProperties: false
      properties:
        code: { $ref: "#/components/schemas/Code" }
        nameEn: { $ref: "#/components/schemas/Name" }
        nameAr: { $ref: "#/components/schemas/Name" }
        description: { type: string, minLength: 1, maxLength: 2000 }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
    GroupUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        nameEn: { $ref: "#/components/schemas/Name" }
        nameAr: { $ref: "#/components/schemas/Name" }
        description: { type: [string, "null"], minLength: 1, maxLength: 2000 }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        status: { type: string, enum: [active, archived] }
    GroupPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/Group" } }
        nextCursor: { type: [string, "null"] }
    GroupMember:
      type: object
      required: [id, groupId, userId, displayName, effectiveFrom, effectiveTo, removedAt, removedBy, removeReason, version]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        groupId: { $ref: "#/components/schemas/Uuid" }
        userId: { $ref: "#/components/schemas/Uuid" }
        displayName: { type: string }
        effectiveFrom: { $ref: "#/components/schemas/Timestamp" }
        effectiveTo: { $ref: "#/components/schemas/NullableTimestamp" }
        removedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        removedBy: { $ref: "#/components/schemas/NullableUuid" }
        removeReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
    GroupMemberCreate:
      type: object
      required: [userId]
      additionalProperties: false
      properties:
        userId: { $ref: "#/components/schemas/Uuid" }
        effectiveFrom: { $ref: "#/components/schemas/Timestamp" }
        effectiveTo: { $ref: "#/components/schemas/Timestamp" }
    GroupMemberPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/GroupMember" } }
        nextCursor: { type: [string, "null"] }
    GovernanceParty:
      type: object
      required: [code, ordinal, kind, roleCode, labelEn, labelAr, sourceRef]
      additionalProperties: false
      properties:
        code: { $ref: "#/components/schemas/PartyCode" }
        ordinal: { type: integer, minimum: 1 }
        kind: { type: string, enum: [role, forum, office, owner_group] }
        roleCode: { type: [string, "null"] }
        labelEn: { type: string }
        labelAr: { type: string }
        sourceRef: { type: string }
    GovernancePartyList:
      type: object
      required: [items]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/GovernanceParty" } }
    RoleMapping:
      type: object
      required: [id, transformationId, partyCode, targetKind, userId, groupId, targetDisplayName, status, endedAt, endedBy, endReason, version, createdAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        partyCode: { $ref: "#/components/schemas/PartyCode" }
        targetKind: { type: string, enum: [user, group] }
        userId: { $ref: "#/components/schemas/NullableUuid" }
        groupId: { $ref: "#/components/schemas/NullableUuid" }
        targetDisplayName: { type: string }
        status: { type: string, enum: [active, ended] }
        endedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        endedBy: { $ref: "#/components/schemas/NullableUuid" }
        endReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
    RoleMappingCreate:
      type: object
      required: [partyCode, targetKind]
      additionalProperties: false
      properties:
        partyCode: { $ref: "#/components/schemas/PartyCode" }
        targetKind: { type: string, enum: [user, group] }
        userId: { $ref: "#/components/schemas/Uuid" }
        groupId: { $ref: "#/components/schemas/Uuid" }
    RoleMappingPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/RoleMapping" } }
        nextCursor: { type: [string, "null"] }
    PartyResolution:
      type: object
      required: [partyCode, status, mappingId, targetKind, userId, groupId]
      additionalProperties: false
      properties:
        partyCode: { $ref: "#/components/schemas/PartyCode" }
        status: { type: string, enum: [mapped, unmapped] }
        mappingId: { $ref: "#/components/schemas/NullableUuid" }
        targetKind: { type: [string, "null"], enum: [user, group, null] }
        userId: { $ref: "#/components/schemas/NullableUuid" }
        groupId: { $ref: "#/components/schemas/NullableUuid" }
    Delegation:
      type: object
      required: [id, organizationId, delegatorUserId, delegateUserId, scopeType, scopeId, recordTypes, reasonCode, reasonText, absenceNote, requestedByUserId, effectiveFrom, effectiveTo, status, revokedAt, revokedBy, revokeReason, version, createdAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        organizationId: { $ref: "#/components/schemas/Uuid" }
        delegatorUserId: { $ref: "#/components/schemas/Uuid" }
        delegateUserId: { $ref: "#/components/schemas/Uuid" }
        scopeType: { type: [string, "null"] }
        scopeId: { $ref: "#/components/schemas/NullableUuid" }
        recordTypes: { type: [array, "null"], items: { type: string } }
        reasonCode: { type: string, enum: [absence, other] }
        reasonText: { type: [string, "null"] }
        absenceNote: { type: [string, "null"] }
        requestedByUserId: { $ref: "#/components/schemas/NullableUuid" }
        effectiveFrom: { $ref: "#/components/schemas/Timestamp" }
        effectiveTo: { $ref: "#/components/schemas/Timestamp" }
        status: { type: string, enum: [active, revoked, expired] }
        revokedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        revokedBy: { $ref: "#/components/schemas/NullableUuid" }
        revokeReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
    DelegationCreate:
      type: object
      required: [delegateUserId, reasonCode, effectiveFrom, effectiveTo]
      additionalProperties: false
      properties:
        delegatorUserId: { $ref: "#/components/schemas/Uuid", description: "Omitted = the caller. Another person only with delegation.manage, on that person's request." }
        delegateUserId: { $ref: "#/components/schemas/Uuid" }
        scopeType: { type: string, enum: [organization, business_unit, transformation, portfolio, workstream, initiative, performance_area, forum, record] }
        scopeId: { $ref: "#/components/schemas/Uuid" }
        recordTypes: { type: array, minItems: 1, maxItems: 20, items: { type: string, pattern: "^[a-z_]+$", maxLength: 64 } }
        reasonCode: { type: string, enum: [absence, other] }
        reasonText: { type: string, minLength: 1, maxLength: 1000 }
        absenceNote: { type: string, minLength: 1, maxLength: 1000 }
        effectiveFrom: { $ref: "#/components/schemas/Timestamp" }
        effectiveTo: { $ref: "#/components/schemas/Timestamp" }
    DelegationPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/Delegation" } }
        nextCursor: { type: [string, "null"] }
    ApprovalParty:
      type: object
      required: [partyCode, userId, groupId]
      additionalProperties: false
      properties:
        partyCode: { $ref: "#/components/schemas/PartyCode" }
        userId: { $ref: "#/components/schemas/NullableUuid" }
        groupId: { $ref: "#/components/schemas/NullableUuid" }
    ApprovalDecisionEntry:
      type: object
      required: [id, roundNo, outcome, rationale, comments, subjectVersion, decidedBy, onBehalfOfUserId, decidedAt, businessDate, deferUntil]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        roundNo: { type: integer, minimum: 1 }
        outcome: { type: string, enum: [approve, reject, request_changes, defer] }
        rationale: { type: string }
        comments: { type: [string, "null"] }
        subjectVersion: { $ref: "#/components/schemas/Version" }
        decidedBy: { $ref: "#/components/schemas/Uuid" }
        onBehalfOfUserId: { $ref: "#/components/schemas/NullableUuid" }
        decidedAt: { $ref: "#/components/schemas/Timestamp" }
        businessDate: { $ref: "#/components/schemas/BusinessDate" }
        deferUntil: { $ref: "#/components/schemas/NullableBusinessDate" }
    ApprovalEscalation:
      type: object
      required: [id, roundNo, dueDate, level, fromPartyCode, toPartyCode, toUserId, toGroupId, routingError, escalatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        roundNo: { type: integer, minimum: 1 }
        dueDate: { $ref: "#/components/schemas/BusinessDate" }
        level: { type: integer, minimum: 1, maximum: 5 }
        fromPartyCode: { $ref: "#/components/schemas/PartyCode" }
        toPartyCode: { type: [string, "null"] }
        toUserId: { $ref: "#/components/schemas/NullableUuid" }
        toGroupId: { $ref: "#/components/schemas/NullableUuid" }
        routingError: { type: [string, "null"], enum: [no_next_authority, party_unmapped, party_not_approver, null] }
        escalatedAt: { $ref: "#/components/schemas/Timestamp" }
    Approval:
      type: object
      required: [id, transformationId, approvalType, subjectType, subjectId, subjectVersion, roundNo, decisionRightId, title, requestNote, requestedBy, requestedAt, requestBusinessDate, assignee, slaType, urgentReason, dueDate, dueUnknownReason, calendarId, status, escalationLevel, escalatedTo, decidedBy, decidedOnBehalfOf, decidedAt, decisions, escalations, version, createdAt, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        approvalType: { type: string }
        subjectType: { type: string }
        subjectId: { $ref: "#/components/schemas/Uuid" }
        subjectVersion: { $ref: "#/components/schemas/Version" }
        roundNo: { type: integer, minimum: 1 }
        decisionRightId: { $ref: "#/components/schemas/NullableUuid" }
        title: { type: string }
        requestNote: { type: [string, "null"] }
        requestedBy: { $ref: "#/components/schemas/Uuid" }
        requestedAt: { $ref: "#/components/schemas/Timestamp" }
        requestBusinessDate: { $ref: "#/components/schemas/BusinessDate" }
        assignee: { $ref: "#/components/schemas/ApprovalParty" }
        slaType: { type: [string, "null"], enum: [working_days, next_steerco_or_urgent, release_plan, null] }
        urgentReason: { type: [string, "null"] }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate", description: "null = Unknown; see dueUnknownReason." }
        dueUnknownReason: { type: [string, "null"], enum: [no_steerco_scheduled, no_release_date, calendar_not_configured, no_sla, null] }
        calendarId: { $ref: "#/components/schemas/NullableUuid" }
        status: { type: string, enum: [pending, changes_requested, deferred, approved, rejected, withdrawn] }
        escalationLevel: { type: integer, minimum: 0, maximum: 5 }
        escalatedTo:
          oneOf:
            - { $ref: "#/components/schemas/ApprovalParty" }
            - { type: "null" }
        decidedBy: { $ref: "#/components/schemas/NullableUuid" }
        decidedOnBehalfOf: { $ref: "#/components/schemas/NullableUuid" }
        decidedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        decisions: { type: array, items: { $ref: "#/components/schemas/ApprovalDecisionEntry" } }
        escalations: { type: array, items: { $ref: "#/components/schemas/ApprovalEscalation" } }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    ApprovalRequest:
      type: object
      required: [approvalType, subjectId, subjectVersion, decisionRightId, title]
      additionalProperties: false
      properties:
        approvalType: { type: string, enum: [decision_request], description: "Types requested through this operation; other modules request their own types (e.g. governance_matrix_change through submitGovernanceMatrix)." }
        subjectId: { $ref: "#/components/schemas/Uuid" }
        subjectVersion: { $ref: "#/components/schemas/Version" }
        decisionRightId: { $ref: "#/components/schemas/Uuid" }
        title: { type: string, minLength: 1, maxLength: 300 }
        requestNote: { type: string, minLength: 1, maxLength: 4000 }
        urgent: { type: boolean, default: false }
        urgentReason: { type: string, minLength: 1, maxLength: 2000 }
        releaseMilestoneId: { $ref: "#/components/schemas/Uuid" }
    ApprovalDecisionCreate:
      type: object
      required: [outcome, rationale, subjectVersion]
      additionalProperties: false
      properties:
        outcome: { type: string, enum: [approve, reject, request_changes, defer] }
        rationale: { type: string, maxLength: 8000, description: "Required; blank text is 422 approval.rationale_required." }
        comments: { type: string, minLength: 1, maxLength: 8000 }
        subjectVersion: { $ref: "#/components/schemas/Version" }
        deferUntil: { $ref: "#/components/schemas/BusinessDate" }
        onBehalfOfUserId: { $ref: "#/components/schemas/Uuid" }
    ApprovalResubmit:
      type: object
      required: [subjectVersion]
      additionalProperties: false
      properties:
        subjectVersion: { $ref: "#/components/schemas/Version" }
        requestNote: { type: string, minLength: 1, maxLength: 4000 }
    ApprovalPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/Approval" } }
        nextCursor: { type: [string, "null"] }
    ApprovalDecisionRecord:
      type: object
      required: [source, recordId, approvalKind, subjectType, subjectId, subjectVersion, outcome, rationale, decidedBy, onBehalfOfUserId, decidedAt]
      additionalProperties: false
      properties:
        source: { type: string, enum: [approval, gate_decision, funding_decision] }
        recordId: { $ref: "#/components/schemas/Uuid" }
        approvalKind: { type: string }
        subjectType: { type: string }
        subjectId: { $ref: "#/components/schemas/Uuid" }
        subjectVersion: { type: [integer, "null"] }
        outcome: { type: string, enum: [approved, rejected, changes_requested, deferred, revoked] }
        rationale: { type: string }
        decidedBy: { $ref: "#/components/schemas/Uuid" }
        onBehalfOfUserId: { $ref: "#/components/schemas/NullableUuid" }
        decidedAt: { $ref: "#/components/schemas/Timestamp" }
    ApprovalDecisionRecordPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/ApprovalDecisionRecord" } }
        nextCursor: { type: [string, "null"] }
    SlaType:
      type: string
      enum: [working_days, next_steerco_or_urgent, release_plan]
    DecisionRightTemplate:
      type: object
      required: [key, ordinal, sourceDecisionEn, sourceRecommendEn, sourceApproveEn, sourceConsultEn, sourceInformEn, sourceSlaEn, decisionAr, recommendAr, approveAr, consultAr, informAr, slaAr, recommendParties, approvePartyCode, consultParties, informParties, slaType, slaWorkingDays, escalationChain, sourceRef]
      additionalProperties: false
      properties:
        key: { type: string }
        ordinal: { type: integer, minimum: 1 }
        sourceDecisionEn: { type: string }
        sourceRecommendEn: { type: string }
        sourceApproveEn: { type: string }
        sourceConsultEn: { type: string }
        sourceInformEn: { type: string }
        sourceSlaEn: { type: string }
        decisionAr: { type: string }
        recommendAr: { type: string }
        approveAr: { type: string }
        consultAr: { type: string }
        informAr: { type: string }
        slaAr: { type: string }
        recommendParties: { type: array, items: { $ref: "#/components/schemas/PartyCode" } }
        approvePartyCode: { $ref: "#/components/schemas/PartyCode" }
        consultParties: { type: array, items: { $ref: "#/components/schemas/PartyCode" } }
        informParties: { type: array, items: { $ref: "#/components/schemas/PartyCode" } }
        slaType: { $ref: "#/components/schemas/SlaType" }
        slaWorkingDays: { type: [integer, "null"] }
        escalationChain: { type: array, items: { $ref: "#/components/schemas/PartyCode" } }
        sourceRef: { type: string }
    DecisionRightTemplateList:
      type: object
      required: [items]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/DecisionRightTemplate" } }
    DecisionRight:
      type: object
      required: [id, transformationId, templateKey, ordinal, decisionEn, decisionAr, recommendLabel, approveLabel, consultLabel, informLabel, slaLabel, recommendParties, approvePartyCode, consultParties, informParties, slaType, slaWorkingDays, urgentWorkingDays, escalationChain, status, version, createdAt, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        templateKey: { type: [string, "null"] }
        ordinal: { type: integer, minimum: 1, maximum: 999 }
        decisionEn: { $ref: "#/components/schemas/LocalizedLabel" }
        decisionAr: { $ref: "#/components/schemas/LocalizedLabel" }
        recommendLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        approveLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        consultLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        informLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        slaLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        recommendParties: { type: array, items: { $ref: "#/components/schemas/PartyCode" } }
        approvePartyCode: { $ref: "#/components/schemas/PartyCode" }
        consultParties: { type: array, items: { $ref: "#/components/schemas/PartyCode" } }
        informParties: { type: array, items: { $ref: "#/components/schemas/PartyCode" } }
        slaType: { $ref: "#/components/schemas/SlaType" }
        slaWorkingDays: { type: [integer, "null"] }
        urgentWorkingDays: { type: [integer, "null"] }
        escalationChain: { type: array, minItems: 1, maxItems: 5, items: { $ref: "#/components/schemas/PartyCode" } }
        status: { type: string, enum: [active, retired] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    DecisionRightCreate:
      type: object
      required: [decisionEn, decisionAr, recommendLabel, approveLabel, consultLabel, informLabel, slaLabel, approvePartyCode, slaType, escalationChain]
      additionalProperties: false
      properties:
        ordinal: { type: integer, minimum: 1, maximum: 999 }
        decisionEn: { $ref: "#/components/schemas/LocalizedLabel" }
        decisionAr: { $ref: "#/components/schemas/LocalizedLabel" }
        recommendLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        approveLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        consultLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        informLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        slaLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        recommendParties: { type: array, maxItems: 10, items: { $ref: "#/components/schemas/PartyCode" } }
        approvePartyCode: { $ref: "#/components/schemas/PartyCode" }
        consultParties: { type: array, maxItems: 10, items: { $ref: "#/components/schemas/PartyCode" } }
        informParties: { type: array, maxItems: 10, items: { $ref: "#/components/schemas/PartyCode" } }
        slaType: { $ref: "#/components/schemas/SlaType" }
        slaWorkingDays: { type: integer }
        urgentWorkingDays: { type: integer }
        escalationChain: { type: array, minItems: 1, maxItems: 5, items: { $ref: "#/components/schemas/PartyCode" } }
    DecisionRightUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        ordinal: { type: integer, minimum: 1, maximum: 999 }
        decisionEn: { $ref: "#/components/schemas/LocalizedLabel" }
        decisionAr: { $ref: "#/components/schemas/LocalizedLabel" }
        recommendLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        approveLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        consultLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        informLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        slaLabel: { $ref: "#/components/schemas/LocalizedLabel" }
        recommendParties: { type: array, maxItems: 10, items: { $ref: "#/components/schemas/PartyCode" } }
        approvePartyCode: { $ref: "#/components/schemas/PartyCode" }
        consultParties: { type: array, maxItems: 10, items: { $ref: "#/components/schemas/PartyCode" } }
        informParties: { type: array, maxItems: 10, items: { $ref: "#/components/schemas/PartyCode" } }
        slaType: { $ref: "#/components/schemas/SlaType" }
        slaWorkingDays: { type: [integer, "null"] }
        urgentWorkingDays: { type: [integer, "null"] }
        escalationChain: { type: array, minItems: 1, maxItems: 5, items: { $ref: "#/components/schemas/PartyCode" } }
        status: { type: string, enum: [active, retired] }
    DecisionRightPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/DecisionRight" } }
        nextCursor: { type: [string, "null"] }
    DueDatePreview:
      type: object
      required: [decisionRightId, slaType, raisedOn, dueDate, unknownReason, calendarId, calendarVersion]
      additionalProperties: false
      properties:
        decisionRightId: { $ref: "#/components/schemas/Uuid" }
        slaType: { $ref: "#/components/schemas/SlaType" }
        raisedOn: { $ref: "#/components/schemas/BusinessDate" }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate", description: "null = Unknown, never a guessed date." }
        unknownReason: { type: [string, "null"], enum: [no_steerco_scheduled, no_release_date, calendar_not_configured, null] }
        calendarId: { $ref: "#/components/schemas/NullableUuid" }
        calendarVersion: { type: [integer, "null"] }
    RaciCell:
      type: object
      required: [partyCode, value]
      additionalProperties: false
      properties:
        partyCode: { $ref: "#/components/schemas/PartyCode" }
        value:
          type: [string, "null"]
          maxLength: 3
          description: "A, R, C, I or A/R; null = no involvement. Any other value (e.g. X) is 422 raci.invalid_value."
    RaciTemplate:
      type: object
      required: [parties, deliverables]
      additionalProperties: false
      properties:
        parties: { type: array, items: { $ref: "#/components/schemas/PartyCode" }, description: "Column order: SP, TL, BO, WL, FIN, TD." }
        deliverables:
          type: array
          items:
            type: object
            required: [key, ordinal, sourceDeliverableEn, deliverableAr, sourceRef, cells]
            additionalProperties: false
            properties:
              key: { type: string }
              ordinal: { type: integer, minimum: 1 }
              sourceDeliverableEn: { type: string }
              deliverableAr: { type: string }
              sourceRef: { type: string }
              cells: { type: array, items: { $ref: "#/components/schemas/RaciCell" } }
    RaciDeliverable:
      type: object
      required: [id, transformationId, templateKey, ordinal, labelEn, labelAr, accountabilityException, status, cells, version, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        templateKey: { type: [string, "null"] }
        ordinal: { type: integer, minimum: 1, maximum: 999 }
        labelEn: { $ref: "#/components/schemas/LocalizedLabel" }
        labelAr: { $ref: "#/components/schemas/LocalizedLabel" }
        accountabilityException: { type: [string, "null"] }
        status: { type: string, enum: [active, retired] }
        cells: { type: array, items: { $ref: "#/components/schemas/RaciCell" } }
        version: { $ref: "#/components/schemas/Version" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    RaciDeliverableCreate:
      type: object
      required: [labelEn, labelAr, cells]
      additionalProperties: false
      properties:
        ordinal: { type: integer, minimum: 1, maximum: 999 }
        labelEn: { $ref: "#/components/schemas/LocalizedLabel" }
        labelAr: { $ref: "#/components/schemas/LocalizedLabel" }
        accountabilityException: { type: string, minLength: 10, maxLength: 2000 }
        cells: { type: array, minItems: 1, maxItems: 20, items: { $ref: "#/components/schemas/RaciCell" } }
    RaciDeliverableUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        ordinal: { type: integer, minimum: 1, maximum: 999 }
        labelEn: { $ref: "#/components/schemas/LocalizedLabel" }
        labelAr: { $ref: "#/components/schemas/LocalizedLabel" }
        accountabilityException: { type: [string, "null"], minLength: 10, maxLength: 2000 }
        status: { type: string, enum: [active, retired] }
        cells: { type: array, minItems: 1, maxItems: 20, items: { $ref: "#/components/schemas/RaciCell" } }
    GovernanceMatrix:
      type: object
      required: [id, transformationId, kind, status, approvedVersion, approvedAt, approvedBy, openApprovalId, version, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        kind: { type: string, enum: [decision_rights, raci] }
        status: { type: string, enum: [draft, in_approval, approved] }
        approvedVersion: { type: [integer, "null"] }
        approvedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        approvedBy: { $ref: "#/components/schemas/NullableUuid" }
        openApprovalId: { $ref: "#/components/schemas/NullableUuid" }
        version: { $ref: "#/components/schemas/Version" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    GovernanceMatrixList:
      type: object
      required: [items]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/GovernanceMatrix" } }
    GovernanceMatrixSubmit:
      type: object
      required: [title]
      additionalProperties: false
      properties:
        title: { type: string, minLength: 1, maxLength: 300 }
        requestNote: { type: string, minLength: 1, maxLength: 4000 }
    Raci:
      type: object
      required: [transformationId, matrix, parties, deliverables]
      additionalProperties: false
      properties:
        transformationId: { $ref: "#/components/schemas/Uuid" }
        matrix: { $ref: "#/components/schemas/GovernanceMatrix" }
        parties: { type: array, items: { $ref: "#/components/schemas/PartyCode" } }
        deliverables: { type: array, items: { $ref: "#/components/schemas/RaciDeliverable" } }
    TransformReadiness:
      type: object
      required: [transformationId, phase, status, checks]
      additionalProperties: false
      properties:
        transformationId: { $ref: "#/components/schemas/Uuid" }
        phase: { type: string, const: transform }
        status: { type: string, enum: [ready, not_ready] }
        checks:
          type: array
          items:
            type: object
            required: [code, passed, missing]
            additionalProperties: false
            properties:
              code: { type: string, enum: [charter_decision_rights, t11_seeded_decisions, t11_approvers_mapped, t12_accountable] }
              passed: { type: boolean }
              missing: { type: array, items: { type: string } }
'''

TAGS = '''  - name: calendar
    description: Business calendars, holidays and working-day due dates (P4, ADR-0025).
  - name: jobs
    description: Recurring jobs of the scheduled-job kit (P4, ADR-0025).
  - name: tasks
    description: My Work items and the in-app inbox (P4, ADR-0025).
  - name: groups
    description: Governed groups (routing targets; they grant no permission) (P4, ADR-0026).
  - name: role-mappings
    description: Governance parties and their mapping to named people or groups per transformation (P4, ADR-0026).
  - name: delegations
    description: Delegation with effective dates, absence handling and loop refusal (P4, ADR-0026).
  - name: approvals
    description: The P4 business-approval record - approve, reject, request changes, defer; never decided by a timer (P4, ADR-0026).
  - name: decision-rights
    description: T11 Decision Rights Matrix, seeded verbatim from B0099 (P4, ADR-0026).
  - name: raci
    description: T12 RACI per transformation, matrix approval and Transform readiness (P4, ADR-0026).
'''

INFO_ADD = '''
    **P4 additions, slices I and C (T-DG4-ARCH-01, ADR-0025, ADR-0026).** Additive within v1: new paths, schemas and
    tags, and new values of the response-only `PermissionCode` enum. Every P1-P3 path is byte-stable. Transform
    readiness (REQ-PB-008) is a new path beside the unchanged DG3 readiness operation. Working-day due dates come from
    the configured business calendar (Asia/Riyadh by default, no holiday until one is configured); a due date that
    cannot be computed is `null` (Unknown) with a reason, never elapsed days. Approvals are business approvals decided
    by named people: a timer escalates an overdue approval once per due date and never decides it.
'''


def main(path):
    s = open(path, encoding="utf-8").read()
    assert "operationId: listBusinessCalendars" not in s, "already applied"
    s = s.replace("  version: 1.2.0-p3\n", "  version: 1.3.0-p4\n", 1)
    anchor = "    statuses. Selection, funding, weight-set and override approvals and dispensations are business approvals\n    recorded as a named person's decision; nothing auto-approves.\n"
    assert anchor in s
    s = s.replace(anchor, anchor + INFO_ADD, 1)
    tag_anchor = "security:\n  - sessionCookie: []\npaths:\n"
    assert tag_anchor in s
    s = s.replace(tag_anchor, TAGS + tag_anchor, 1)
    comp = "\ncomponents:\n"
    assert s.count(comp) == 1
    s = s.replace(comp, "\n" + render_paths() + "components:\n", 1)
    p_anchor = "  parameters:\n    IfMatch:\n"
    assert p_anchor in s
    s = s.replace(p_anchor, "  parameters:\n" + render_params() + "    IfMatch:\n", 1)
    s = s.rstrip("\n") + "\n" + SCHEMAS
    open(path, "w", encoding="utf-8").write(s)
    print(f"added {len(OPS)} operations: " + ", ".join(o["id"] for o in OPS))


if __name__ == "__main__":
    main(sys.argv[1])
