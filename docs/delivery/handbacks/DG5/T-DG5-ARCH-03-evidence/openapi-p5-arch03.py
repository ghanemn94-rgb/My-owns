# T-DG5-ARCH-03: appends the slice D and E operations (ADR-0043, ADR-0044) to docs/api/openapi.yaml (info.version stays
# 1.4.0-p5). Every P1-P4 path and every slice A-C path stays byte-stable, except: the PermissionCode enum gains the eight
# P5_AUTOMATION_PERMISSIONS codes, and TransformationCreate gains the optional launchPlan member (p5-plan §3 row 15,
# adopted by D-142; additive). The helper functions are copied from the T-DG5-ARCH-02 generator. Run once from the
# repository root.
F = "docs/api/openapi.yaml"
s = open(F).read()
assert s.count("\n  version: 1.4.0-p5\n") == 1

R = lambda name: f'{{ $ref: "#/components/responses/{name}" }}'
NAMES = {400: "ValidationError", 401: "Unauthenticated", 403: "Forbidden", 404: "NotFound", 409: "VersionConflict",
         422: "BusinessRule", 428: "PreconditionRequired", 429: "RateLimited"}
def resp(codes):
    out = ""
    for c in codes:
        if isinstance(c, tuple):
            out += f'        "{c[0]}": {R(c[1])}\n'
        else:
            out += f'        "{c}": {R(NAMES[c])}\n'
    return out
def key(c):
    return int(c[0]) if isinstance(c, tuple) else c

def op(method, tag, opid, summary, *, params=(), body=None, ok=200, okdesc="OK.", schema=None, etag=False, created=False,
       ifmatch=None, codes=(400, 401, 403, 404, 422, 429), write=True, csv=False):
    out = f"    {method}:\n      tags: [{tag}]\n      operationId: {opid}\n      summary: \"{summary}\"\n"
    if write:
        out += "      security:\n        - sessionCookie: []\n          csrfToken: []\n"
    ps = list(params) + ([ifmatch] if ifmatch else [])
    if ps:
        out += "      parameters:\n" + "".join(f'        - $ref: "#/components/parameters/{p}"\n' for p in ps)
    if body:
        out += f'      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: {{ $ref: "#/components/schemas/{body}" }}\n'
    out += f'      responses:\n        "{ok}":\n          description: "{okdesc}"\n'
    hdr = []
    if created:
        hdr.append('            Location: { $ref: "#/components/headers/Location" }\n')
    if etag:
        hdr.append('            ETag: { $ref: "#/components/headers/ETag" }\n')
    if hdr:
        out += "          headers:\n" + "".join(hdr)
    out += "          content:\n"
    if csv:
        out += "            text/csv:\n              schema: { type: string, description: 'RFC 4180 UTF-8 with BOM; header labels in the requested language (ADR-0041 §5).' }\n"
    out += f'            application/json:\n              schema: {{ $ref: "#/components/schemas/{schema}" }}\n'
    cs = list(codes)
    if ifmatch:
        have = {key(c) for c in cs}
        for c in (409, 428):
            if c not in have:
                cs.append(c)
    cs.sort(key=key)
    return out + resp(cs)

def path(p, params, *ops):
    out = f"  {p}:\n"
    if params:
        out += "    parameters:\n" + "".join(f'      - $ref: "#/components/parameters/{x}"\n' for x in params)
    return out + "".join(ops)
assert "/api/v1/admin/automation-rules:" not in s, "already applied"

RD = (400, 401, 403, 404, 429)
LS = (400, 401, 403, 429)
paths = []
A = "/api/v1/admin"
RULE = A + "/automation-rules/{ruleId}"
VER_ = RULE + "/versions/{versionNo}"
RV = ["AutomationRuleId", "AutomationVersionNo"]
# ---------------- Slice D: the automation engine (ADR-0043)
paths.append(path(A + "/automation-catalogue", [],
  op("get", "automation", "getAutomationCatalogue", "The triggers (event, schedule; with their condition fields and whether they name an initiating user) and action types a rule can use, plus the human-only action types listed so the builder can name them (automation.read; ADR-0043 §2).", schema="AutomationCatalogue", write=False, codes=LS)))
paths.append(path(A + "/automation-rules", [],
  op("get", "automation", "listAutomationRules", "Automation rules in the caller's scope: the sixteen starters (platform) and admin rules, with owner, scope, enabled state, whether they may be disabled and the effective version (automation.read).", params=["Cursor", "Limit", "AutomationRuleOriginQuery", "AutomationRuleEnabledQuery", "TransformationIdQuery"], schema="AutomationRulePage", write=False, codes=LS),
  op("post", "automation", "createAutomationRule", "Create an admin rule (disabled) with its draft version 1 (automation.configure; ADM_METHOD). 409 automation_rule.code_taken; 422 automation_rule.human_only_action, trigger_unknown, action_unknown, condition_invalid, action_parameters_invalid, initiating_user_unavailable, service_permission_forbidden, scope_invalid.", body="AutomationRuleCreate", ok=201, okdesc="Created (disabled, version 1 draft).", schema="AutomationRule", etag=True, created=True, codes=(400, 401, 403, ("409", "Duplicate"), 422, 429))))
paths.append(path(RULE, ["AutomationRuleId"],
  op("get", "automation", "getAutomationRule", "One rule with its effective version and its readable summary in en and ar (automation.read).", schema="AutomationRule", etag=True, write=False, codes=RD),
  op("patch", "automation", "updateAutomationRule", "Change an admin rule's names, description or owner; a starter's names only (automation.configure).", body="AutomationRuleUpdate", schema="AutomationRule", etag=True, ifmatch="IfMatch")))
paths.append(path(RULE + "/enable", ["AutomationRuleId"],
  op("post", "automation", "enableAutomationRule", "Enable a rule that has an effective version (automation.configure). 422 automation_rule.no_effective_version.", schema="AutomationRule", etag=True, ifmatch="IfMatch")))
paths.append(path(RULE + "/disable", ["AutomationRuleId"],
  op("post", "automation", "disableAutomationRule", "Disable an admin rule with a reason; the sixteen starters are guarantees and are refused (automation.configure; D-142 Q3). 422 automation_rule.guarantee_protected.", body="AutomationRuleDisable", schema="AutomationRule", etag=True, ifmatch="IfMatch")))
paths.append(path(RULE + "/versions", ["AutomationRuleId"],
  op("get", "automation", "listAutomationRuleVersions", "The versions of one rule, newest first (automation.read).", params=["Cursor", "Limit"], schema="AutomationRuleVersionPage", write=False, codes=RD),
  op("post", "automation", "createAutomationRuleVersion", "Open a new draft version copied from the effective version; If-Match is the rule's version (automation.configure). 409 automation_rule_version.draft_exists.", body="AutomationRuleVersionCreate", ok=201, okdesc="Created (draft).", schema="AutomationRuleVersion", etag=True, created=True, ifmatch="IfMatch")))
paths.append(path(VER_, RV,
  op("get", "automation", "getAutomationRuleVersion", "One version: triggers, conditions, actions, identity, service permissions, parameters, content hash, status, review and publication, and its readable summary in en and ar (automation.read).", schema="AutomationRuleVersion", etag=True, write=False, codes=RD),
  op("patch", "automation", "updateAutomationRuleVersion", "Change the content of a draft version; a starter version takes parameters only (automation.configure). 409 automation_rule_version.not_editable; 422 automation_rule.human_only_action, trigger_unknown, action_unknown, condition_invalid, action_parameters_invalid, initiating_user_unavailable, service_permission_forbidden, starter_fixed.", body="AutomationRuleVersionUpdate", schema="AutomationRuleVersion", etag=True, ifmatch="IfMatch")))
paths.append(path(VER_ + "/dry-runs", RV,
  op("get", "automation", "listAutomationDryRuns", "Dry runs of one version, newest first (automation.read).", params=["Cursor", "Limit"], schema="AutomationDryRunPage", write=False, codes=RD),
  op("post", "automation", "runAutomationDryRun", "Evaluate a draft against a sample event in a rolled-back read-only transaction: conditions, planned actions and permission checks; writes only the dry-run record, never a task, notification or record (automation.configure; REQ-S12-002). 409 automation_rule_version.not_editable; 422 automation.dry_run_sample_invalid.", body="AutomationDryRunRequest", ok=201, okdesc="Created (the dry-run record).", schema="AutomationDryRun", created=True, codes=(400, 401, 403, 404, ("409", "VersionConflict"), 422, 429))))
paths.append(path(VER_ + "/submit", RV,
  op("post", "automation", "submitAutomationRuleVersion", "Submit a draft for its configured review; needs a pass dry run of the current content (automation.configure). 422 automation_rule_version.dry_run_required, invalid_transition.", schema="AutomationRuleVersion", etag=True, ifmatch="IfMatch")))
paths.append(path(VER_ + "/review", RV,
  op("post", "automation", "decideAutomationRuleReview", "Approve a version in review, or send it back to draft with a note; a configuration review, not a business approval (automation.review; TO). 403 automation_rule_version.self_review; 422 automation_rule_version.invalid_transition.", body="AutomationRuleReviewDecision", schema="AutomationRuleVersion", etag=True, ifmatch="IfMatch")))
paths.append(path(VER_ + "/publish", RV,
  op("post", "automation", "publishAutomationRuleVersion", "Publish an approved version (or a draft with a pass dry run when the policy requires no review); it becomes the rule's effective version and the previous one is superseded; If-Match is the rule's version (automation.configure). 422 automation_rule_version.review_required, dry_run_required, invalid_transition.", schema="AutomationRuleVersion", etag=True, ifmatch="IfMatch")))
paths.append(path(VER_ + "/discard", RV,
  op("post", "automation", "discardAutomationRuleVersion", "Discard an open version (automation.configure). 422 automation_rule_version.invalid_transition.", schema="AutomationRuleVersion", etag=True, ifmatch="IfMatch")))
paths.append(path(A + "/automation-executions", [],
  op("get", "automation", "listAutomationExecutions", "Execution history, newest first: rule, version, trigger event, identity, outcome, attempt and error (automation.read; REQ-S12-001).", params=["Cursor", "Limit", "AutomationRuleIdQuery", "AutomationExecutionStatusQuery", "TransformationIdQuery"], schema="AutomationExecutionPage", write=False, codes=LS)))
paths.append(path(A + "/automation-executions/{executionId}", ["AutomationExecutionId"],
  op("get", "automation", "getAutomationExecution", "One execution with each action result per attempt (outcome, idempotency key, produced record, error) (automation.read).", schema="AutomationExecution", write=False, codes=RD)))
paths.append(path(A + "/automation-failures", [],
  op("get", "automation", "listAutomationFailures", "The failure queue: failed rule executions (automation.read) and failed jobs (job.read), open first, with attempts, error, retries and the repair actions allowed to the caller.", params=["Cursor", "Limit", "OperationalFailureSourceQuery", "OperationalFailureStatusQuery"], schema="OperationalFailurePage", write=False, codes=LS)))
paths.append(path(A + "/automation-failures/{failureId}", ["OperationalFailureId"],
  op("get", "automation", "getAutomationFailure", "One failure-queue entry (automation.read for rule executions; job.read for jobs).", schema="OperationalFailure", etag=True, write=False, codes=RD)))
paths.append(path(A + "/automation-failures/{failureId}/retry", ["OperationalFailureId"],
  op("post", "automation", "retryAutomationFailure", "Retry an open failure with its original idempotency key; completed effects are not repeated (automation.repair for rule executions; job.repair for jobs). 422 automation_failure.not_open, retry_limit.", schema="OperationalFailure", etag=True, ifmatch="IfMatch")))
paths.append(path(A + "/automation-failures/{failureId}/dismiss", ["OperationalFailureId"],
  op("post", "automation", "dismissAutomationFailure", "Dismiss an open failure with a reason (automation.repair for rule executions; job.repair for jobs). 422 automation_failure.not_open.", body="OperationalFailureDismiss", schema="OperationalFailure", etag=True, ifmatch="IfMatch")))
paths.append(path(A + "/jobs", [],
  op("get", "jobs", "listJobOperations", "The jobs operations view: every scheduled job with last success (null = never run), next run (null with a reason: disabled or unknown), last outcome, open failures and repair actions (job.read; ADM_TECH; REQ-S12-022).", schema="JobOperationList", write=False, codes=LS)))
paths.append(path(A + "/jobs/{jobCode}", ["JobCode"],
  op("get", "jobs", "getJobOperation", "One scheduled job with its recent runs, newest first (job.read).", params=["Cursor", "Limit"], schema="JobOperationDetail", write=False, codes=RD)))
paths.append(path(A + "/jobs/{jobCode}/run", ["JobCode"],
  op("post", "jobs", "runJobNow", "Run a scheduled job now once (singleton per minute); the run is recorded like a scheduled one (job.repair; ADM_TECH). 422 job.schedule_disabled.", ok=202, okdesc="Accepted (sent to the queue).", schema="JobRunNowResult", codes=(400, 401, 403, 404, 422, 429))))
# ---------------- Slice E (ADR-0044)
paths.append(path(A + "/approval-routes", [],
  op("get", "approval-routes", "listApprovalRoutes", "The sequential and parallel approval routes resolved from a published methodology version (default: the newest): route key, mode, roles in order. Routes are edited in Studio as approver_route elements (methodology.read; REQ-S10-015).", params=["ConfigVersionIdQuery"], schema="ApprovalRouteDefinitionList", write=False, codes=LS)))
paths.append(path("/api/v1/approvals/{approvalId}/route", ["ApprovalId"],
  op("get", "approval-routes", "getApprovalRoute", "The route steps of one approval for its current round (and earlier rounds as history): role, status, activation, decision (the approval's read rule).", schema="ApprovalRoute", etag=True, write=False, codes=RD)))
paths.append(path("/api/v1/approvals/{approvalId}/route/steps/{stepNo}/decision", ["ApprovalId", "ApprovalRouteStepNo"],
  op("post", "approval-routes", "decideApprovalRouteStep", "Decide an active step of the current round: approve, reject or request changes; the approval completes when every step is approved (approval.decide in scope and the step's role; If-Match is the approval's version). 403 approval_route.not_step_approver, self_decision, one_step_per_person; 422 approval_route.step_not_active.", body="ApprovalRouteStepDecision", schema="ApprovalRoute", etag=True, ifmatch="IfMatch")))
T = "/api/v1/transformations/{transformationId}"
paths.append(path(T + "/gate-conditions", ["TransformationId"],
  op("get", "gate-conditions", "listGateConditions", "Conditions of conditional approvals in the transformation with owner, due date and derived status open, overdue or closed, closure and escalation (transformation.read; REQ-S04-011).", params=["Cursor", "Limit", "GateConditionStatusQuery"], schema="TrackedGateConditionPage", write=False, codes=RD)))
paths.append(path(T + "/gate-conditions/{conditionId}/close", ["TransformationId", "GateConditionId"],
  op("post", "gate-conditions", "closeGateCondition", "Close a condition you own with a note and optional evidence (gate_condition.close). 403 gate_condition.not_owner; 422 gate_condition.already_closed.", body="GateConditionClose", ok=201, okdesc="Created (the closure).", schema="TrackedGateCondition", created=True, codes=(400, 401, 403, 404, 422, 429))))
paths.append(path(T + "/dependency-slips", ["TransformationId"],
  op("get", "dependency-slips", "listDependencySlips", "Critical dependency slips, newest first: dependency, slip in calendar days, the reason it is critical and each affected initiative with owner and forecast finish before and after (null = Unknown) (transformation.read; REQ-S12-012).", params=["Cursor", "Limit"], schema="DependencySlipPage", write=False, codes=RD)))
MT = T + "/meetings/{meetingId}"
paths.append(path(MT + "/cutoff-pack", ["TransformationId", "MeetingId"],
  op("get", "meetings", "getMeetingCutoffPack", "The draft agenda and pack generated at the meeting's cut-off: as-of time, the open asks snapshot, the draft agenda items and the review state (transformation.read; REQ-S12-015).", schema="MeetingCutoffPack", etag=True, write=False, codes=RD)))
paths.append(path(MT + "/cutoff-pack/review", ["TransformationId", "MeetingId"],
  op("post", "meetings", "reviewMeetingCutoffPack", "Mark the cut-off pack reviewed so its agenda items can be published (the meeting's chair with meeting.chair or its secretary with meeting.prepare). 403 meeting_cutoff_pack.not_reviewer; 422 meeting_cutoff_pack.already_reviewed.", body="MeetingCutoffPackReview", schema="MeetingCutoffPack", etag=True, ifmatch="IfMatch")))
paths.append(path("/api/v1/me/notification-preferences", [],
  op("get", "notifications", "getMyNotificationPreferences", "Your quiet hours, time zone and digest preference, with the organization defaults that apply when you set none; version 0 when none stored (authenticated).", schema="NotificationPreferences", etag=True, write=False, codes=(400, 401, 429)),
  op("put", "notifications", "putMyNotificationPreferences", "Set your quiet hours, time zone and digest preference; If-Match 0 creates (notification.preferences). 422 notification_preference.quiet_hours_invalid, timezone_unknown.", body="NotificationPreferencesPut", schema="NotificationPreferences", etag=True, ifmatch="IfMatchOrZero")))
paths.append(path("/api/v1/me/notification-digests/{digestId}", ["NotificationDigestId"],
  op("get", "notifications", "getMyNotificationDigest", "One of your digests with the notifications it delivered (own digests only; others 404).", schema="NotificationDigest", write=False, codes=(400, 401, 404, 429))))
paths.append(path(A + "/notification-policy", [],
  op("get", "notifications", "getNotificationPolicy", "Your organization's notification policy: working-day timing, default quiet hours, default digest and urgent delivery; version 0 when none stored (notification_policy.configure).", schema="NotificationPolicy", etag=True, write=False, codes=(400, 401, 403, 429)),
  op("put", "notifications", "putNotificationPolicy", "Set your organization's notification policy; If-Match 0 creates (notification_policy.configure; ADM_TECH). 422 notification_preference.quiet_hours_invalid.", body="NotificationPolicyPut", schema="NotificationPolicy", etag=True, ifmatch="IfMatchOrZero")))

old_enum = "        - procedure.manage\n    RoleCode:\n"
assert s.count(old_enum) == 1
s = s.replace(old_enum, "        - procedure.manage\n" + "".join(f"        - {c}\n" for c in [
    "automation.read", "automation.configure", "automation.review", "automation.repair", "job.repair",
    "notification_policy.configure", "notification.preferences", "gate_condition.close"]) + "    RoleCode:\n", 1)
old_tc = "        currency: { $ref: \"#/components/schemas/Currency\" }\n      allOf:\n        - if:\n            properties: { mode: { const: modular } }"
assert s.count(old_tc) == 1
s = s.replace(old_tc, "        currency: { $ref: \"#/components/schemas/Currency\" }\n        launchPlan: { $ref: \"#/components/schemas/LaunchPlanStart\" }\n      allOf:\n        - if:\n            properties: { mode: { const: modular } }", 1)

anchor = "\ncomponents:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, "\n" + "".join(paths) + "components:\n", 1)

tags = """  - name: automation
    description: Automation rules with versions, dry run, review where configured, publish, enable/disable, execution history and the failure queue with retry and dismiss; the sixteen starters run as seeded rules (P5, ADR-0043, ADR-0044).
  - name: approval-routes
    description: Sequential and parallel approval routes and the decision of route steps; every step is a human business approval (P5, ADR-0044).
  - name: gate-conditions
    description: Conditions of conditional approvals tracked to closure, with escalation when overdue (P5, ADR-0044).
  - name: dependency-slips
    description: Critical dependency slips with their affected owners and forecast impacts (P5, ADR-0044).
  - name: notifications
    description: Notification preferences and policy - working-day timing, quiet hours, digests and urgent delivery; in-app channel (P5, ADR-0044).
"""
old_tags_end = "\nsecurity:\n  - sessionCookie: []\npaths:\n"
assert s.count(old_tags_end) == 1
s = s.replace(old_tags_end, "\n" + tags + "security:\n  - sessionCookie: []\npaths:\n", 1)

U = '{ $ref: "#/components/schemas/Uuid" }'
NU = '{ $ref: "#/components/schemas/NullableUuid" }'
TS = '{ $ref: "#/components/schemas/Timestamp" }'
NTS = '{ $ref: "#/components/schemas/NullableTimestamp" }'
VER = '{ $ref: "#/components/schemas/Version" }'
BD = '{ $ref: "#/components/schemas/BusinessDate" }'
NBD = '{ $ref: "#/components/schemas/NullableBusinessDate" }'
RC = '{ $ref: "#/components/schemas/RoleCode" }'
PC = '{ $ref: "#/components/schemas/PermissionCode" }'
STR = "{ type: string }"
NSTR = '{ type: [string, "null"] }'
TXT = lambda lo, hi: f"{{ type: string, minLength: {lo}, maxLength: {hi} }}"
NTXT = lambda lo, hi: f'{{ type: [string, "null"], minLength: {lo}, maxLength: {hi} }}'
REF = lambda n: f'{{ $ref: "#/components/schemas/{n}" }}'
ARR = lambda n, mx=None: f'{{ type: array{", maxItems: " + str(mx) if mx else ""}, items: {{ $ref: "#/components/schemas/{n}" }} }}'
SARR = lambda mx: f"{{ type: array, maxItems: {mx}, items: {{ type: string }} }}"
HHMM = "{ type: string, pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }"
NHHMM = "{ type: [string, \"null\"], pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }"
def obj(name, desc, props, required=None):
    req = required if required is not None else [k for k, _ in props]
    out = f"    {name}:\n      type: object\n"
    if desc:
        out += f'      description: "{desc}"\n'
    out += f"      required: [{', '.join(req)}]\n" if req else ""
    out += "      additionalProperties: false\n      properties:\n" + "".join(f"        {k}: {v}\n" for k, v in props)
    return out
def page(name, item):
    return obj(name, None, [("items", ARR(item)), ("nextCursor", NSTR)])

params = """    AutomationRuleId:
      name: ruleId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    AutomationVersionNo:
      name: versionNo
      in: path
      required: true
      schema: { type: integer, minimum: 1 }
    AutomationExecutionId:
      name: executionId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    OperationalFailureId:
      name: failureId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    ApprovalRouteStepNo:
      name: stepNo
      in: path
      required: true
      schema: { type: integer, minimum: 1, maximum: 6 }
    GateConditionId:
      name: conditionId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    NotificationDigestId:
      name: digestId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    AutomationRuleOriginQuery:
      name: origin
      in: query
      required: false
      schema: { type: string, enum: [starter, admin] }
    AutomationRuleEnabledQuery:
      name: enabled
      in: query
      required: false
      schema: { type: boolean }
    AutomationRuleIdQuery:
      name: ruleId
      in: query
      required: false
      schema: { $ref: "#/components/schemas/Uuid" }
    AutomationExecutionStatusQuery:
      name: status
      in: query
      required: false
      schema: { type: string, enum: [running, succeeded, skipped, failed] }
    OperationalFailureSourceQuery:
      name: source
      in: query
      required: false
      schema: { type: string, enum: [rule_execution, job] }
    OperationalFailureStatusQuery:
      name: status
      in: query
      required: false
      schema: { type: string, enum: [open, retrying, resolved, dismissed] }
    GateConditionStatusQuery:
      name: status
      in: query
      required: false
      schema: { type: string, enum: [open, overdue, closed] }
"""
assert s.count("\n  parameters:\n") == 1
s = s.replace("\n  parameters:\n", "\n  parameters:\n" + params, 1)

COND = '{ type: object, additionalProperties: false, required: [field, op], properties: { field: { type: string, pattern: "^[a-z][a-zA-Z0-9]{0,39}$" }, op: { type: string, enum: [eq, neq, in, gt, gte, lt, lte, present, absent] }, value: { description: "A string, a decimal string, a boolean or an array of up to 50 strings; numbers are decimal strings, never floats.", oneOf: [{ type: string, maxLength: 500 }, { type: boolean }, { type: array, maxItems: 50, items: { type: string, maxLength: 500 } }] } } }'
ACT = '{ type: object, additionalProperties: false, required: [type], properties: { type: { type: string, pattern: "^[a-z][a-z0-9_]{2,63}$" }, parameters: { type: object, description: "Validated by the action type schema (ADR-0043 §2)." }, handlers: { type: array, maxItems: 6, items: { type: string }, description: "starter_handler only (read-only)." } } }'
schemas = []
schemas.append(obj("LaunchPlanStart", "Optional on create (REQ-S12-004): generate the 90-day plan dated from startDate (day d = startDate + d calendar days; ADR-0048).", [("startDate", BD)]))
schemas.append(obj("AutomationTrigger", None, [("code", STR), ("triggerKind", "{ type: string, enum: [event, schedule, request] }"), ("ownerModule", STR), ("labelEn", STR), ("labelAr", STR),
  ("conditionFields", SARR(30)), ("hasInitiatingUser", "{ type: boolean }"), ("adminSelectable", "{ type: boolean }"), ("sourceRef", STR)]))
schemas.append(obj("AutomationActionType", "humanOnly types are never selectable: approvals, investment decisions and Finance attestations stay human (REQ-S12-026).", [("code", STR), ("actionClass", "{ type: string, enum: [automatic, human_only] }"), ("ownerModule", STR),
  ("labelEn", STR), ("labelAr", STR), ("requiredPermissionCode", '{ oneOf: [{ $ref: "#/components/schemas/PermissionCode" }, { type: "null" }] }'), ("adminSelectable", "{ type: boolean }"), ("parametersSchema", "{ type: object }"), ("sourceRef", STR)]))
schemas.append(obj("AutomationCatalogue", None, [("triggers", ARR("AutomationTrigger")), ("actionTypes", ARR("AutomationActionType"))]))
schemas.append(obj("AutomationRuleSummary", "Readable summary of a version for the builder, rendered from its content in en and ar.", [("en", STR), ("ar", STR)]))
schemas.append(obj("AutomationRule", "A rule (M0221): trigger, conditions and actions live in its versions; disableAllowed = false marks a guarantee starter (D-142 Q3).", [
  ("id", U), ("code", STR), ("origin", "{ type: string, enum: [starter, admin] }"), ("sourceRef", NSTR), ("nameEn", STR), ("nameAr", STR), ("descriptionEn", NSTR), ("descriptionAr", NSTR),
  ("scopeLevel", "{ type: string, enum: [platform, organization, transformation] }"), ("organizationId", NU), ("transformationId", NU),
  ("ownerUserId", NU), ("ownerRoleCode", '{ oneOf: [{ $ref: "#/components/schemas/RoleCode" }, { type: "null" }] }'),
  ("enabled", "{ type: boolean }"), ("disableAllowed", "{ type: boolean }"), ("disabledReason", NSTR),
  ("effectiveVersionId", NU), ("effectiveVersionNo", '{ type: ["integer", "null"] }'), ("openVersionNo", '{ type: ["integer", "null"] }'), ("summary", '{ oneOf: [{ $ref: "#/components/schemas/AutomationRuleSummary" }, { type: "null" }] }'),
  ("version", VER), ("updatedAt", TS)]))
schemas.append(page("AutomationRulePage", "AutomationRule"))
schemas.append(obj("AutomationRuleContent", None, [("triggerCodes", "{ type: array, minItems: 1, maxItems: 6, items: { type: string } }"), ("conditions", f"{{ type: array, maxItems: 20, items: {COND} }}"),
  ("actions", f"{{ type: array, minItems: 1, maxItems: 10, items: {ACT} }}"), ("runAs", "{ type: string, enum: [initiating_user, service] }"),
  ("servicePermissionCodes", f"{{ type: array, maxItems: 20, items: {PC} }}"), ("parameters", "{ type: object }")], required=["triggerCodes", "actions", "runAs"]))
schemas.append(obj("AutomationRuleCreate", "Creates an admin rule (disabled) and its draft version 1.", [
  ("code", "{ type: string, pattern: '^[a-z][a-z0-9_.]{2,63}$' }"), ("nameEn", TXT(1, 200)), ("nameAr", TXT(1, 200)), ("descriptionEn", TXT(1, 2000)), ("descriptionAr", TXT(1, 2000)),
  ("scopeLevel", "{ type: string, enum: [organization, transformation] }"), ("organizationId", U), ("transformationId", U), ("ownerUserId", U),
  ("content", REF("AutomationRuleContent"))], required=["code", "nameEn", "nameAr", "scopeLevel", "organizationId", "ownerUserId", "content"]))
schemas.append(obj("AutomationRuleUpdate", None, [("nameEn", TXT(1, 200)), ("nameAr", TXT(1, 200)), ("descriptionEn", NTXT(1, 2000)), ("descriptionAr", NTXT(1, 2000)), ("ownerUserId", U)], required=[]))
schemas.append(obj("AutomationRuleDisable", None, [("reason", TXT(3, 1000))]))
schemas.append(obj("AutomationRuleVersion", None, [
  ("id", U), ("ruleId", U), ("versionNo", "{ type: integer, minimum: 1 }"), ("status", "{ type: string, enum: [draft, in_review, approved, published, superseded, discarded] }"),
  ("content", REF("AutomationRuleContent")), ("contentSha256", "{ type: string, pattern: '^[0-9a-f]{64}$' }"), ("changeSummary", NSTR),
  ("lastDryRun", '{ oneOf: [{ $ref: "#/components/schemas/AutomationDryRun" }, { type: "null" }] }'), ("dryRunCurrent", "{ type: boolean }"),
  ("authoredBy", NU), ("submittedAt", NTS), ("reviewedBy", NU), ("reviewedAt", NTS), ("reviewNote", NSTR),
  ("publishedBy", NU), ("publishedAt", NTS), ("supersededAt", NTS), ("discardedAt", NTS), ("summary", REF("AutomationRuleSummary")), ("version", VER), ("updatedAt", TS)]))
schemas.append(page("AutomationRuleVersionPage", "AutomationRuleVersion"))
schemas.append(obj("AutomationRuleVersionCreate", None, [("changeSummary", TXT(3, 2000))], required=[]))
schemas.append(obj("AutomationRuleVersionUpdate", "A starter version accepts parameters (and changeSummary) only.", [("content", REF("AutomationRuleContent")), ("changeSummary", NTXT(3, 2000))], required=[]))
schemas.append(obj("AutomationRuleReviewDecision", None, [("outcome", "{ type: string, enum: [approve, request_changes] }"), ("note", TXT(3, 2000))], required=["outcome"]))
schemas.append(obj("AutomationDryRunRequest", "A sample event: its triggerCode and a payload with the trigger's fields (synthetic data).", [("triggerCode", STR), ("payload", "{ type: object }")]))
schemas.append(obj("AutomationPlannedAction", None, [("ordinal", "{ type: integer, minimum: 1 }"), ("actionType", STR), ("outcome", "{ type: string, enum: [would_run, forbidden, invalid] }"),
  ("target", "{ type: object }"), ("idempotencyKey", STR), ("messageKey", NSTR)]))
schemas.append(obj("AutomationDryRun", "Nothing but this record was written (REQ-S12-002).", [("id", U), ("versionId", U), ("contentSha256", STR), ("outcome", "{ type: string, enum: [pass, fail] }"),
  ("conditionsMet", '{ type: ["boolean", "null"] }'), ("plannedActions", ARR("AutomationPlannedAction", 10)),
  ("findings", '{ type: array, maxItems: 50, items: { type: object, additionalProperties: false, required: [code, messageEn, messageAr], properties: { code: { type: string }, pointer: { type: string }, messageEn: { type: string }, messageAr: { type: string } } } }'),
  ("runBy", U), ("createdAt", TS)]))
schemas.append(page("AutomationDryRunPage", "AutomationDryRun"))
schemas.append(obj("AutomationActionResult", None, [("attemptNo", "{ type: integer, minimum: 1 }"), ("ordinal", "{ type: integer, minimum: 1 }"), ("actionType", STR), ("idempotencyKey", STR),
  ("outcome", "{ type: string, enum: [done, existing, skipped, failed, forbidden] }"), ("resultRecordType", NSTR), ("resultRecordId", NU), ("errorCode", NSTR), ("createdAt", TS)]))
schemas.append(obj("AutomationExecution", "Each execution names its rule version, trigger event and outcome (REQ-S12-001).", [
  ("id", U), ("ruleId", U), ("ruleCode", STR), ("versionId", U), ("versionNo", "{ type: integer, minimum: 1 }"), ("triggerCode", STR), ("triggerKey", STR),
  ("organizationId", NU), ("transformationId", NU), ("runAs", "{ type: string, enum: [initiating_user, service] }"), ("initiatingUserId", NU),
  ("status", "{ type: string, enum: [running, succeeded, skipped, failed] }"), ("conditionsMet", '{ type: ["boolean", "null"] }'), ("attemptNo", "{ type: integer, minimum: 1 }"),
  ("errorCode", NSTR), ("errorDetail", NSTR), ("startedAt", TS), ("finishedAt", NTS), ("actionResults", ARR("AutomationActionResult"))]))
schemas.append(page("AutomationExecutionPage", "AutomationExecution"))
schemas.append(obj("OperationalFailure", "One failure-queue entry (M0240); retries keep the original idempotency key.", [
  ("id", U), ("source", "{ type: string, enum: [rule_execution, job] }"), ("organizationId", NU), ("executionId", NU), ("jobScheduleCode", NSTR), ("queueName", STR),
  ("jobId", NSTR), ("idempotencyKey", STR), ("errorCode", STR), ("errorMessage", STR), ("attempts", "{ type: integer, minimum: 1 }"),
  ("firstFailedAt", TS), ("lastFailedAt", TS), ("status", "{ type: string, enum: [open, retrying, resolved, dismissed] }"), ("retryCount", "{ type: integer, minimum: 0, maximum: 20 }"),
  ("lastRetryBy", NU), ("lastRetryAt", NTS), ("resolvedAt", NTS), ("dismissedBy", NU), ("dismissedAt", NTS), ("dismissReason", NSTR),
  ("allowedActions", '{ type: array, items: { type: string, enum: [retry, dismiss] } }'), ("version", VER), ("updatedAt", TS)]))
schemas.append(page("OperationalFailurePage", "OperationalFailure"))
schemas.append(obj("OperationalFailureDismiss", None, [("reason", TXT(3, 1000))]))
schemas.append(obj("JobOperation", "lastSuccessAt null = never run; nextRunAt null with nextRunUnknownReason disabled or unknown (never a guessed time).", [
  ("code", STR), ("queueName", STR), ("cron", STR), ("timezone", STR), ("enabled", "{ type: boolean }"), ("ownerModule", STR), ("descriptionEn", STR), ("descriptionAr", STR),
  ("lastSuccessAt", NTS), ("lastRunAt", NTS), ("lastOutcome", '{ type: ["string", "null"], enum: [succeeded, failed, null] }'),
  ("nextRunAt", NTS), ("nextRunUnknownReason", '{ type: ["string", "null"], enum: [disabled, unknown, null] }'), ("openFailures", "{ type: integer, minimum: 0 }"),
  ("allowedActions", '{ type: array, items: { type: string, enum: [run_now, retry_failures] } }')]))
schemas.append(obj("JobOperationList", None, [("items", ARR("JobOperation"))]))
schemas.append(obj("JobRun", None, [("id", U), ("jobId", STR), ("attemptNo", "{ type: integer, minimum: 1 }"), ("outcome", "{ type: string, enum: [succeeded, failed] }"), ("startedAt", TS), ("finishedAt", TS), ("errorCode", NSTR)]))
schemas.append(obj("JobOperationDetail", None, [("job", REF("JobOperation")), ("runs", ARR("JobRun")), ("nextCursor", NSTR)]))
schemas.append(obj("JobRunNowResult", None, [("code", STR), ("jobId", NSTR), ("singletonKey", STR), ("queuedAt", TS)]))
schemas.append(obj("ApprovalRouteDefinition", None, [("routeKey", STR), ("mode", "{ type: string, enum: [any, sequential, parallel] }"), ("roleCodes", f"{{ type: array, minItems: 1, maxItems: 6, items: {RC} }}"),
  ("source", "{ type: string, enum: [approver_route, procedure] }"), ("labelEn", NSTR), ("labelAr", NSTR)]))
schemas.append(obj("ApprovalRouteDefinitionList", None, [("methodologyVersionId", U), ("items", ARR("ApprovalRouteDefinition"))]))
schemas.append(obj("ApprovalRouteStep", None, [("stepNo", "{ type: integer, minimum: 1, maximum: 6 }"), ("roundNo", "{ type: integer, minimum: 1 }"), ("approverRoleCode", RC),
  ("assigneeUserId", NU), ("status", "{ type: string, enum: [waiting, active, approved, rejected, changes_requested, cancelled] }"),
  ("activatedAt", NTS), ("decidedBy", NU), ("decidedOnBehalfOf", NU), ("decidedAt", NTS), ("decisionNote", NSTR)]))
schemas.append(obj("ApprovalRoute", "routed = false: a DG4 single-step approval without route steps.", [("approvalId", U), ("routed", "{ type: boolean }"), ("routeKey", NSTR),
  ("mode", '{ type: ["string", "null"], enum: [sequential, parallel, null] }'), ("currentRoundNo", "{ type: integer, minimum: 1 }"), ("steps", ARR("ApprovalRouteStep")),
  ("approvalStatus", STR), ("approvalVersion", VER)]))
schemas.append(obj("ApprovalRouteStepDecision", None, [("outcome", "{ type: string, enum: [approve, reject, request_changes] }"), ("note", TXT(3, 4000))], required=["outcome"]))
schemas.append(obj("TrackedGateCondition", "status is derived: closed (closure recorded), overdue (open after its due date in the transformation's time zone), else open.", [
  ("id", U), ("gateDecisionId", U), ("gateCode", STR), ("ordinal", "{ type: integer }"), ("conditionText", STR), ("ownerUserId", U), ("dueDate", BD),
  ("status", "{ type: string, enum: [open, overdue, closed] }"), ("closedAt", NTS), ("closedBy", NU), ("closureNote", NSTR), ("evidenceId", NU),
  ("escalatedAt", NTS), ("escalatedToUserId", NU)]))
schemas.append(page("TrackedGateConditionPage", "TrackedGateCondition"))
schemas.append(obj("GateConditionClose", None, [("note", TXT(3, 2000)), ("evidenceId", U)], required=["note"]))
schemas.append(obj("DependencySlipAffected", "Forecast finishes are computed by the DG4 scheduling logic; null = Unknown.", [("initiativeId", U), ("initiativeCode", STR), ("ownerUserId", NU),
  ("forecastFinishBefore", NBD), ("forecastFinishAfter", NBD)]))
schemas.append(obj("DependencySlip", None, [("id", U), ("dependencyId", U), ("dependencyCode", STR), ("predecessorFinishBefore", BD), ("predecessorFinishAfter", BD),
  ("slipDays", "{ type: integer, minimum: 1, description: 'Calendar days.' }"), ("neededBy", NBD), ("criticalReason", "{ type: string, enum: [critical_path, needed_by_breached] }"),
  ("affected", ARR("DependencySlipAffected", 200)), ("createdAt", TS)]))
schemas.append(page("DependencySlipPage", "DependencySlip"))
schemas.append(obj("MeetingCutoffPack", "A draft generated from current data at the cut-off; its agenda items are published only after review (REQ-S12-015).", [
  ("id", U), ("meetingId", U), ("cutoffDate", BD), ("asOf", TS), ("openAsks", "{ type: array, maxItems: 200, items: { type: object } }"),
  ("agendaItemIds", "{ type: array, maxItems: 200, items: { $ref: \"#/components/schemas/Uuid\" } }"), ("status", "{ type: string, enum: [draft, reviewed] }"),
  ("reviewedBy", NU), ("reviewedAt", NTS), ("reviewNote", NSTR), ("reviewerAssigned", "{ type: boolean }"), ("version", VER), ("updatedAt", TS)]))
schemas.append(obj("MeetingCutoffPackReview", None, [("note", TXT(3, 2000))], required=[]))
schemas.append(obj("NotificationSettings", "Quiet hours as HH:MM in timeZone (may span midnight; both null = none); digest off, daily or twice daily.", [
  ("quietHoursStart", NHHMM), ("quietHoursEnd", NHHMM), ("timezone", STR), ("digestMode", "{ type: string, enum: [off, daily, twice_daily] }"), ("digestTime", HHMM)]))
schemas.append(obj("NotificationPreferences", "effective = own settings, else the organization defaults, else none (deliver at once).", [("own", '{ oneOf: [{ $ref: "#/components/schemas/NotificationSettings" }, { type: "null" }] }'),
  ("effective", REF("NotificationSettings")), ("version", "{ type: integer, minimum: 0 }")]))
schemas.append(obj("NotificationPreferencesPut", None, [("quietHoursStart", NHHMM), ("quietHoursEnd", NHHMM), ("timezone", '{ $ref: "#/components/schemas/TimeZone" }'),
  ("digestMode", "{ type: string, enum: [off, daily, twice_daily] }"), ("digestTime", HHMM)], required=["quietHoursStart", "quietHoursEnd", "digestMode"]))
schemas.append(obj("NotificationPolicy", "Urgent notifications are always delivered immediately (REQ-S12-025).", [("organizationId", U), ("nonUrgentWorkingDaysOnly", "{ type: boolean }"),
  ("defaultQuietHoursStart", NHHMM), ("defaultQuietHoursEnd", NHHMM), ("defaultDigestMode", "{ type: string, enum: [off, daily, twice_daily] }"),
  ("urgentDelivery", "{ type: string, enum: [immediate] }"), ("urgentKinds", "{ type: array, items: { type: string } }"), ("version", "{ type: integer, minimum: 0 }")]))
schemas.append(obj("NotificationPolicyPut", None, [("nonUrgentWorkingDaysOnly", "{ type: boolean }"), ("defaultQuietHoursStart", NHHMM), ("defaultQuietHoursEnd", NHHMM),
  ("defaultDigestMode", "{ type: string, enum: [off, daily, twice_daily] }")]))
schemas.append(obj("NotificationDigestItem", None, [("notificationId", U), ("messageKey", STR), ("messageParams", "{ type: object }"), ("linkPath", STR), ("createdAt", TS)]))
schemas.append(obj("NotificationDigest", None, [("id", U), ("windowStart", TS), ("windowEnd", TS), ("count", "{ type: integer, minimum: 1 }"), ("items", ARR("NotificationDigestItem"))]))

anchor = "\n  schemas:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + "".join(schemas), 1)
open(F, "w").write(s)
print("operations added:", sum(p.count("operationId:") for p in paths))
