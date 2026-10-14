# T-DG5-ARCH-05: appends the slice G and H operations (ADR-0047, ADR-0048) to docs/api/openapi.yaml (info.version stays
# 1.4.0-p5). Every P1-P4 path and every slice A-F path stays byte-stable, except two additive enum extensions: the
# PermissionCode enum gains the seven P5_KPI_LAUNCH_HEALTH_PERMISSIONS codes and ConfigElementType gains health_response and
# health_band (both slice A/F precedents). The helper functions are copied from the T-DG5-ARCH-04 generator.
# Run once from the repository root: python3 -I docs/delivery/handbacks/DG5/T-DG5-ARCH-05-evidence/openapi-p5-arch05.py
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
       ifmatch=None, codes=(400, 401, 403, 404, 422, 429), write=True, extra_ok=None, binary=False):
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
    if binary:
        for mt in ["application/pdf",
                   "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                   "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                   "text/csv"]:
            out += f"            {mt}:\n              schema: {{ type: string, contentMediaType: {mt} }}\n"
    else:
        out += f'            application/json:\n              schema: {{ $ref: "#/components/schemas/{schema}" }}\n'
    if extra_ok:
        code, desc, sch = extra_ok
        out += f'        "{code}":\n          description: "{desc}"\n'
        if etag:
            out += '          headers:\n            ETag: { $ref: "#/components/headers/ETag" }\n'
        out += f'          content:\n            application/json:\n              schema: {{ $ref: "#/components/schemas/{sch}" }}\n'
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

RD = (400, 401, 403, 404, 429)
LS = (400, 401, 403, 429)
paths = []
T = "/api/v1/transformations/{transformationId}"
TP = ["TransformationId"]
SNAP = T + "/report-snapshots/{snapshotId}"
TXT = lambda lo, hi: f"{{ type: string, minLength: {lo}, maxLength: {hi} }}"
NTXT = lambda lo, hi: f'{{ type: [string, "null"], minLength: {lo}, maxLength: {hi} }}'
REF = lambda n: f'{{ $ref: "#/components/schemas/{n}" }}'
ARR = lambda n, mx=None: f'{{ type: array{", maxItems: " + str(mx) if mx else ""}, items: {{ $ref: "#/components/schemas/{n}" }} }}'
ENUM = lambda *v: "{ type: string, enum: [" + ", ".join(v) + "] }"
SHA = "{ type: string, pattern: '^[0-9a-f]{64}$' }"
NSHA = "{ type: [string, \"null\"], pattern: '^[0-9a-f]{64}$' }"
DEFS = ["charter", "diagnostic", "tom", "business_cases", "roadmap", "registers", "meeting_minutes", "gate_pack",
        "executive_dashboard", "handover", "executive_pack", "meeting_pack"]
FORMAT = ENUM("pdf", "docx", "xlsx", "pptx", "csv")
SUBJ = ENUM("transformation", "meeting", "gate_instance", "business_case", "bau_handover")
APPROVAL = ENUM("approved", "pending", "not_submitted", "changes_requested", "rejected", "mixed", "not_applicable")
SRC_APPROVAL = '{ type: [string, "null"], enum: [approved, pending, not_submitted, changes_requested, rejected, not_applicable, null] }'
VALID = ENUM("validated", "provisional", "unknown", "stale", "not_applicable")
SNAPSTATUS = ENUM("generated", "issued", "superseded", "discarded")
def obj(name, desc, props, required=None, extra=""):
    req = required if required is not None else [k for k, _ in props]
    out = f"    {name}:\n      type: object\n"
    if desc:
        out += f'      description: "{desc}"\n'
    out += f"      required: [{', '.join(req)}]\n" if req else ""
    out += extra
    out += "      additionalProperties: false\n      properties:\n" + "".join(f"        {k}: {v}\n" for k, v in props)
    return out
def page(name, item):
    return obj(name, None, [("items", ARR(item)), ("nextCursor", NSTR)])
assert "/api/v1/formula-previews:" not in s, "already applied"

RD = (400, 401, 403, 404, 429)
LS = (400, 401, 403, 429)
PUB = (400, 401, 429)
T = "/api/v1/transformations/{transformationId}"
TP = ["TransformationId"]
paths = []

# ---------------------------------------------------------------- slice G: KPI restatements (ADR-0047 §2-§3)
KR = T + "/kpi-restatements/{restatementId}"
KRP = ["TransformationId", "KpiRestatementId"]
paths.append(path(T + "/kpi-definitions/{kpiDefinitionId}/restatements", ["TransformationId", "KpiDefinitionId"],
  op("get", "kpi-restatements", "listKpiRestatements", "The restatements of a KPI, newest first: periods, status, decision and authority (transformation.read; REQ-S07-016).", params=["Cursor", "Limit"], schema="KpiRestatementPage", write=False, codes=RD),
  op("post", "kpi-restatements", "createKpiRestatement", "Start a retrospective restatement of selected closed periods with an approved KPI version and a reason (kpi_restatement.request; TL, BO, FIN, KDS; REQ-S07-016). Approved changes otherwise apply prospectively. 409 kpi_restatement.open_exists; 422 kpi_restatement.version_not_approved, .periods_required, .too_many_periods, .period_not_closed.", body="KpiRestatementCreate", ok=201, okdesc="Created (draft).", schema="KpiRestatement", etag=True, created=True, codes=(400, 401, 403, 404, 409, 422, 429))))
paths.append(path(KR, KRP,
  op("get", "kpi-restatements", "getKpiRestatement", "One restatement with its selected periods, status, decision and recorded authority (transformation.read).", schema="KpiRestatement", etag=True, write=False, codes=RD)))
paths.append(path(KR + "/reconciliation", KRP,
  op("get", "kpi-restatements", "getKpiRestatementReconciliation", "The reconciliation per selected period, scope and basis: value, status, RAG, target and version before and after, and the difference. For a draft it is computed now and not stored (`retained: false`); from submission on it is the retained record (`retained: true`; transformation.read; M0163).", schema="KpiRestatementReconciliation", write=False, codes=RD)))
paths.append(path(KR + "/submit", KRP,
  op("post", "kpi-restatements", "submitKpiRestatement", "Submit a draft: computes and retains the reconciliation in the same transaction and creates a decision task for each holder of kpi_restatement.approve except the requester (kpi_restatement.request). 422 kpi_restatement.not_draft, .nothing_to_reconcile.", schema="KpiRestatement", etag=True, ifmatch="IfMatch")))
paths.append(path(KR + "/decision", KRP,
  op("post", "kpi-restatements", "decideKpiRestatement", "Approve or reject a submitted restatement (kpi_restatement.approve, a business approval; SP, BO, FIN; never the requester; REQ-S07-016). Approval recalculates the selected periods once and offers the reissue of affected issued reports; issued snapshots never change. 403 kpi_restatement.no_authority, .self_decision; 422 kpi_restatement.not_submitted, .note_required.", body="KpiRestatementDecision", schema="KpiRestatement", etag=True, ifmatch="IfMatch")))
paths.append(path(KR + "/withdraw", KRP,
  op("post", "kpi-restatements", "withdrawKpiRestatement", "Withdraw a draft or submitted restatement (kpi_restatement.request; the requester). 422 kpi_restatement.not_withdrawable.", schema="KpiRestatement", etag=True, ifmatch="IfMatch")))
paths.append(path(KR + "/reissue-offers", KRP,
  op("get", "kpi-restatements", "listKpiRestatementReissueOffers", "The issued report snapshots that showed the restated KPI for a restated period, offered for reissue once the restatement is approved; a reissue is made with reissueReportSnapshot (transformation.read; ADR-0045 §4).", schema="KpiRestatementReissueOfferList", write=False, codes=RD)))

# ---------------------------------------------------------------- slice G: formula preview (ADR-0047 §4)
paths.append(path("/api/v1/formula-previews", [],
  op("post", "formula-previews", "previewFormula", "Preview a formula before publication: the engine's verdict, the result unit, evaluated examples and the zero / missing / negative edge cases; a missing input is not_computable, never 0. Takes a seeded B0087 example (exampleCode) or an expression with typed variables; writes nothing (session; REQ-S08-005). 422 formula.* (ADR-0024 §6).", body="FormulaPreviewRequest", schema="FormulaPreviewResult", codes=(400, 401, 403, 404, 422, 429))))

# ---------------------------------------------------------------- slice G: optional NPV / ROI / payback (ADR-0047 §5)
paths.append(path("/api/v1/benefits/financial-metrics/settings", [],
  op("get", "financial-metrics", "getFinancialMetricSettings", "The organization's optional NPV/ROI/payback extension: on or off (off by default; version 0 when never configured) and the explicit methodology, timing, period-basis and discount-rate assumptions (session; REQ-S08-019).", schema="FinancialMetricSettings", etag=True, write=False, codes=PUB)))
paths.append(path("/api/v1/benefits/financial-metrics/settings/enablement", [],
  op("put", "financial-metrics", "putFinancialMetricEnablement", "Switch the optional extension on or off; If-Match \\\"0\\\" creates the settings (financial_metrics.enable; ADM_METHOD).", body="FinancialMetricEnablement", schema="FinancialMetricSettings", etag=True, ifmatch="IfMatchOrZero", codes=(400, 401, 403, 422, 429))))
paths.append(path("/api/v1/benefits/financial-metrics/settings/assumptions", [],
  op("put", "financial-metrics", "putFinancialMetricAssumptions", "Set the methodology statement, timing convention, period basis and discount rate (a decimal fraction per period, or null for none); If-Match \\\"0\\\" creates the settings (financial_metrics.define; FIN). 422 financial_metrics.assumptions_incomplete, .discount_rate_invalid.", body="FinancialMetricAssumptions", schema="FinancialMetricSettings", etag=True, ifmatch="IfMatchOrZero", codes=(400, 401, 403, 422, 429))))
paths.append(path("/api/v1/business-cases/{businessCaseId}/cash-flows", ["BusinessCaseId"],
  op("get", "financial-metrics", "getBusinessCaseCashFlows", "The current cash-flow set of a business case (outflow and inflow per period index, its revision and basis note; version 0 when none) (transformation.read).", schema="BusinessCaseCashFlows", etag=True, write=False, codes=RD),
  op("put", "financial-metrics", "putBusinessCaseCashFlows", "Replace the cash-flow set as a whole (a new revision; earlier revisions stay as history); If-Match \\\"0\\\" creates it (financial_metrics.define; FIN). 422 financial_cash_flows.currency_mismatch, .periods_invalid.", body="BusinessCaseCashFlowsPut", schema="BusinessCaseCashFlows", etag=True, ifmatch="IfMatchOrZero")))
paths.append(path("/api/v1/business-cases/{businessCaseId}/financial-metrics", ["BusinessCaseId"],
  op("get", "financial-metrics", "getBusinessCaseFinancialMetrics", "NPV, ROI and payback of a business case with the assumptions used, labelled as an extension; nothing when the extension is off, and no NPV without a discount rate (transformation.read; REQ-S08-019).", schema="FinancialMetrics", write=False, codes=RD)))
paths.append(path(T + "/benefits/financial-metrics", TP,
  op("get", "financial-metrics", "listTransformationFinancialMetrics", "The financial metrics of each business case of the transformation, with the same rules as getBusinessCaseFinancialMetrics (transformation.read).", params=["Cursor", "Limit"], schema="FinancialMetricsPage", write=False, codes=RD)))

# ---------------------------------------------------------------- slice H: launch plan (ADR-0048 §1-§3)
LPATH = T + "/launch-plan"
paths.append(path("/api/v1/launch-plan-template", [],
  op("get", "launch-plans", "getLaunchPlanTemplate", "The source 90-day launch plan: the three B0134 windows with objectives, actions and outputs verbatim, and the Day-90 test (session; REQ-PB-086).", schema="LaunchPlanTemplate", write=False, codes=PUB)))
paths.append(path(LPATH, TP,
  op("get", "launch-plans", "getLaunchPlan", "The transformation's 90-day launch plan: start date, last shift and progress (transformation.read). 404 when none was generated.", schema="LaunchPlan", etag=True, write=False, codes=RD),
  op("post", "launch-plans", "generateLaunchPlan", "Generate the plan from a start date: one scheduled task per B0134 action and output and the Day-90 test, day d = start date + d calendar days (launch_plan.edit; TL, TO; REQ-PB-086). 409 launch_plan.exists.", body="LaunchPlanCreate", ok=201, okdesc="Created.", schema="LaunchPlan", etag=True, created=True, codes=(400, 401, 403, 404, 409, 422, 429)),
  op("patch", "launch-plans", "updateLaunchPlan", "Change the start date: every not-started task and an open Day-90 test move by the same number of days; started, completed and cancelled tasks keep their dates (launch_plan.edit; REQ-S14-004).", body="LaunchPlanUpdate", schema="LaunchPlan", etag=True, ifmatch="IfMatch")))
paths.append(path(LPATH + "/tasks", TP,
  op("get", "launch-plans", "listLaunchTasks", "The plan's tasks by due date with owner, status, required output, predecessors and 'blocked by' (the predecessors not completed) (transformation.read; REQ-S14-004).", params=["Cursor", "Limit", "LaunchWindowQuery", "LaunchTaskStatusQuery"], schema="LaunchTaskPage", write=False, codes=RD),
  op("post", "launch-plans", "createLaunchTask", "Add a custom task to a window (launch_plan.edit). 422 validation.user_invalid.", body="LaunchTaskCreate", ok=201, okdesc="Created.", schema="LaunchTask", etag=True, created=True, codes=(400, 401, 403, 404, 422, 429))))
LT = LPATH + "/tasks/{taskId}"
LTP = ["TransformationId", "LaunchTaskId"]
paths.append(path(LT, LTP,
  op("get", "launch-plans", "getLaunchTask", "One task with its predecessors and 'blocked by' (transformation.read).", schema="LaunchTask", etag=True, write=False, codes=RD),
  op("patch", "launch-plans", "updateLaunchTask", "Edit a task: title, notes, dates, owner, status, output record (launch_plan.edit; REQ-S14-004). 422 launch_task.cancelled, .completed_dates_fixed, .status_step, .output_record_invalid, validation.user_invalid.", body="LaunchTaskUpdate", schema="LaunchTask", etag=True, ifmatch="IfMatch")))
paths.append(path(LT + "/predecessors", LTP,
  op("put", "launch-plans", "putLaunchTaskPredecessors", "Replace the task's predecessors (tasks of the same plan; no loop); a removed link is stamped, never deleted (launch_plan.edit; REQ-S14-004). 422 launch_task.predecessor_cycle, .predecessor_other_plan.", body="LaunchTaskPredecessors", schema="LaunchTask", etag=True, ifmatch="IfMatch")))

# ---------------------------------------------------------------- slice H: Day-90 leadership test (ADR-0048 §4)
D90 = T + "/day-90-test"
paths.append(path(D90, TP,
  op("get", "day-90-tests", "getDayNinetyTest", "The Day-90 leadership test of the launch plan: the six B0136-B0141 questions verbatim, responses, pre-filled evidence suggestions and completion ('Incomplete (n/6)' while any is unanswered) (transformation.read; REQ-PB-087).", schema="DayNinetyTest", etag=True, write=False, codes=RD)))
paths.append(path(D90 + "/responses/{questionCode}", ["TransformationId", "DayNinetyQuestionCode"],
  op("put", "day-90-tests", "putDayNinetyResponse", "Record or change the response to one question, with an optional comment and evidence; If-Match of the test (day_ninety_test.respond; SP, TL). 422 day_ninety_test.completed.", body="DayNinetyResponsePut", schema="DayNinetyTest", etag=True, ifmatch="IfMatch")))
paths.append(path(D90 + "/complete", TP,
  op("post", "day-90-tests", "completeDayNinetyTest", "Complete the test once all six questions are answered (day_ninety_test.respond). 422 day_ninety_test.incomplete, .completed.", schema="DayNinetyTest", etag=True, ifmatch="IfMatch")))

# ---------------------------------------------------------------- slice H: health check (ADR-0048 §5-§6)
HC = T + "/health-checks"
HCP = ["TransformationId", "HealthCheckId"]
paths.append(path("/api/v1/health-check-questions", [],
  op("get", "health-checks", "listHealthCheckQuestions", "The 25 Transformation Health Check questions, verbatim from B0150 (session).", schema="HealthCheckQuestionList", write=False, codes=PUB)))
paths.append(path(HC, TP,
  op("get", "health-checks", "listHealthChecks", "The transformation's health checks in sequence (reassessments tracked over time): status, completion, score and band (null while incomplete) and scheme version (transformation.read; REQ-PB-091).", params=["Cursor", "Limit"], schema="HealthCheckPage", write=False, codes=RD),
  op("post", "health-checks", "createHealthCheck", "Start a health check under the transformation's pinned scoring scheme (else v1), linked to the previous submitted one (health_check.assess; TL, TO). 409 health_check.draft_exists.", body="HealthCheckCreate", ok=201, okdesc="Created (draft).", schema="HealthCheck", etag=True, created=True, codes=(400, 401, 403, 404, 409, 422, 429))))
paths.append(path(HC + "/{assessmentId}", HCP,
  op("get", "health-checks", "getHealthCheck", "One health check: the 25 questions with responses, evidence, owner and action; completion ('Incomplete (24/25)'); score out of 25 and band (null while incomplete); the top 3 actions; the scoring method shown as an implementation assumption (transformation.read; REQ-S14-001, REQ-S14-002).", schema="HealthCheck", etag=True, write=False, codes=RD),
  op("patch", "health-checks", "updateHealthCheck", "Change the assessment date or owner of a draft (health_check.assess). 422 health_check.not_draft, validation.user_invalid.", body="HealthCheckUpdate", schema="HealthCheck", etag=True, ifmatch="IfMatch")))
paths.append(path(HC + "/{assessmentId}/answers/{questionCode}", ["TransformationId", "HealthCheckId", "HealthQuestionCode"],
  op("put", "health-checks", "putHealthCheckAnswer", "Record or change one answer (a response of the scheme, evidence, owner, action note); If-Match of the assessment (health_check.assess; REQ-PB-091). 422 health_check.not_draft, .response_not_allowed.", body="HealthCheckAnswerPut", schema="HealthCheck", etag=True, ifmatch="IfMatch")))
paths.append(path(HC + "/{assessmentId}/actions", HCP,
  op("put", "health-checks", "putHealthCheckActions", "Set the top 3 improvement actions (ranks 1-3; health_check.assess; M0288). 422 health_check.not_draft.", body="HealthCheckActionsPut", schema="HealthCheck", etag=True, ifmatch="IfMatch")))
paths.append(path(HC + "/{assessmentId}/submit", HCP,
  op("post", "health-checks", "submitHealthCheck", "Submit a complete health check with its top 3 actions; the score and band are fixed with the scheme version (health_check.assess; REQ-PB-091). 422 health_check.incomplete, .actions_required, .not_computable, .not_draft.", schema="HealthCheck", etag=True, ifmatch="IfMatch")))
paths.append(path("/api/v1/admin/health-check-schemes", [],
  op("get", "health-checks", "listHealthCheckSchemes", "The published health-check scoring schemes: responses with credits, score basis and interpretation bands; v1 is Yes = 1, No = 0 with the four B0152 bands (session; REQ-S14-003). Drafts are authored through the Studio configuration operations (kind health_check_scheme).", schema="HealthCheckSchemeList", write=False, codes=PUB)))
paths.append(path("/api/v1/admin/health-check-schemes/{schemeVersionId}", ["HealthCheckSchemeVersionId"],
  op("get", "health-checks", "getHealthCheckScheme", "One published scoring scheme version (session; REQ-S14-003).", schema="HealthCheckScheme", write=False, codes=(400, 401, 404, 429))))

old_enum = "        - owner_update.submit\n    RoleCode:\n"
assert s.count(old_enum) == 1
s = s.replace(old_enum, "        - owner_update.submit\n" + "".join(f"        - {c}\n" for c in [
    "kpi_restatement.request", "kpi_restatement.approve", "financial_metrics.enable", "financial_metrics.define",
    "launch_plan.edit", "day_ninety_test.respond", "health_check.assess"]) + "    RoleCode:\n", 1)

anchor = "\ncomponents:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, "\n" + "".join(paths) + "components:\n", 1)

tags = """  - name: kpi-restatements
    description: Retrospective KPI restatements with selected closed periods, authority and a retained reconciliation; approved changes otherwise apply prospectively (P5, ADR-0047).
  - name: formula-previews
    description: Formula previews with evaluated examples, the result unit and edge cases before publication (P5, ADR-0047).
  - name: financial-metrics
    description: The optional NPV, ROI and payback extension with explicit methodology, timing and discount-rate assumptions; an extension, not a playbook requirement (P5, ADR-0047).
  - name: launch-plans
    description: The 90-day launch plan as editable scheduled tasks with owners, predecessors and required outputs (P5, ADR-0048).
  - name: day-90-tests
    description: The Day-90 leadership test of the launch plan (P5, ADR-0048).
  - name: health-checks
    description: The 25-question Transformation Health Check, its versioned scoring schemes, score, bands and top 3 actions (P5, ADR-0048).
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
STR = "{ type: string }"
NSTR = '{ type: [string, "null"] }'
INT0 = "{ type: integer, minimum: 0 }"
NINT1 = '{ type: [integer, "null"], minimum: 1 }'
TXT = lambda lo, hi: f"{{ type: string, minLength: {lo}, maxLength: {hi} }}"
NTXT = lambda lo, hi: f'{{ type: [string, "null"], minLength: {lo}, maxLength: {hi} }}'
REF = lambda n: f'{{ $ref: "#/components/schemas/{n}" }}'
ARR = lambda n, mx=None: f'{{ type: array{", maxItems: " + str(mx) if mx else ""}, items: {{ $ref: "#/components/schemas/{n}" }} }}'
ENUM = lambda *v: "{ type: string, enum: [" + ", ".join(v) + "] }"
SHA = "{ type: string, pattern: '^[0-9a-f]{64}$' }"
NSHA = "{ type: [string, \"null\"], pattern: '^[0-9a-f]{64}$' }"

def pparam(name, pname, schema, where="path", required=True, desc=None):
    out = f"    {name}:\n      name: {pname}\n      in: {where}\n      required: {'true' if required else 'false'}\n"
    if desc:
        out += f'      description: "{desc}"\n'
    return out + f"      schema: {schema}\n"
params = "".join([
  pparam("KpiRestatementId", "restatementId", U),
  pparam("LaunchTaskId", "taskId", U),
  pparam("HealthCheckId", "assessmentId", U),
  pparam("HealthCheckSchemeVersionId", "schemeVersionId", U),
  pparam("HealthQuestionCode", "questionCode", "{ type: string, pattern: '^q(0[1-9]|1[0-9]|2[0-5])$' }", desc="Health-check question q01-q25 (B0150)."),
  pparam("DayNinetyQuestionCode", "questionCode", "{ type: string, pattern: '^q[1-6]$' }", desc="Day-90 question q1-q6 (B0136-B0141)."),
  pparam("LaunchWindowQuery", "window", "{ type: string, enum: [days_0_30, days_31_60, days_61_90] }", where="query", required=False),
  pparam("LaunchTaskStatusQuery", "status", "{ type: string, enum: [not_started, in_progress, completed, cancelled] }", where="query", required=False),
])
anchor = "\n  parameters:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + params, 1)

DEC = REF("Decimal")
NDEC = REF("NullableDecimal")
CUR = REF("Currency")
NCUR = '{ oneOf: [{ $ref: "#/components/schemas/Currency" }, { type: "null" }] }'
BOOL = "{ type: boolean }"
INT = "{ type: integer }"
NINT = '{ type: [integer, "null"] }'
RAG = ENUM("green", "amber", "red", "unknown", "stale", "not_computable")
VSTAT = ENUM("ok", "unknown", "stale", "not_computable")
schemas = []
# KPI restatements
schemas.append("    KpiRestatementStatus:\n      type: string\n      enum: [draft, submitted, approved, rejected, withdrawn, applied]\n")
schemas.append(obj("KpiRestatementPeriod", None, [("reportingPeriodId", U), ("periodLabel", STR)]))
schemas.append(obj("KpiRestatement", "A retrospective restatement (ADR-0047 §2). authorityPermission and authorityRoleCode record the right through which the decider approved or rejected (a business approval inside the product, never DG0-DG7).", [
  ("id", U), ("transformationId", U), ("kpiDefinitionId", U), ("kpiVersionId", U), ("changeRequestId", NU), ("reason", STR), ("status", REF("KpiRestatementStatus")),
  ("periods", ARR("KpiRestatementPeriod", 24)), ("requestedBy", U), ("submittedAt", NTS), ("decidedBy", NU), ("decidedAt", NTS), ("decisionNote", NSTR),
  ("authorityPermission", '{ type: [string, "null"], enum: [kpi_restatement.approve, null] }'), ("authorityRoleCode", NSTR), ("calculationRunId", NU), ("appliedAt", NTS),
  ("withdrawnAt", NTS), ("withdrawnBy", NU), ("version", VER), ("createdAt", TS), ("updatedAt", TS)]))
schemas.append(page("KpiRestatementPage", "KpiRestatement"))
schemas.append(obj("KpiRestatementCreate", None, [("kpiVersionId", U), ("reportingPeriodIds", "{ type: array, minItems: 1, maxItems: 24, uniqueItems: true, items: " + U + " }"),
  ("reason", TXT(3, 2000)), ("changeRequestId", NU)], required=["kpiVersionId", "reportingPeriodIds", "reason"]))
schemas.append(obj("KpiRestatementDecision", None, [("decision", ENUM("approve", "reject")), ("note", NTXT(1, 2000))], required=["decision"]))
schemas.append(obj("KpiRestatementValueBefore", "The slot's latest evaluation before the restatement; valueStatus none when it was never evaluated. Unknown, stale and not computable values have no number.", [
  ("evaluationId", NU), ("kpiVersionId", NU), ("value", NDEC), ("valueStatus", ENUM("ok", "unknown", "stale", "not_computable", "none")),
  ("rag", ENUM("green", "amber", "red", "unknown", "stale", "not_computable", "none")), ("target", NDEC)]))
schemas.append(obj("KpiRestatementValueAfter", None, [("value", NDEC), ("valueStatus", VSTAT), ("rag", RAG), ("target", NDEC)]))
schemas.append(obj("KpiRestatementReconciliationRow", None, [("reportingPeriodId", U), ("periodLabel", STR), ("scopeKind", ENUM("transformation", "business_unit", "initiative")),
  ("scopeId", U), ("valueBasis", ENUM("period", "cumulative")), ("before", REF("KpiRestatementValueBefore")), ("after", REF("KpiRestatementValueAfter")),
  ("difference", NDEC), ("currency", NCUR), ("unitKind", ENUM("currency", "percentage", "count", "ratio", "duration", "score", "other"))]))
schemas.append(obj("KpiRestatementReconciliation", None, [("restatementId", U), ("retained", BOOL), ("rows", ARR("KpiRestatementReconciliationRow"))]))
schemas.append(obj("KpiRestatementReissueOffer", None, [("snapshotId", U), ("seriesId", U), ("definitionCode", REF("ReportDefinitionCode")), ("issueVersion", INT),
  ("periodLabel", NSTR), ("snapshotStatus", ENUM("issued", "superseded")), ("createdAt", TS)]))
schemas.append(obj("KpiRestatementReissueOfferList", None, [("items", ARR("KpiRestatementReissueOffer"))]))
# formula preview
schemas.append(obj("FormulaPreviewExampleInput", None, [("label", TXT(1, 100)), ("inputs", '{ type: object, maxProperties: 30, additionalProperties: { $ref: "#/components/schemas/NullableDecimal" } }')]))
schemas.append(obj("FormulaPreviewRequest", "Either exampleCode (a seeded B0087 example) or expression with variables (the FormulaCheckRequest shape); not both.", [
  ("exampleCode", '{ type: string, enum: [revenue_uplift, cost_reduction] }'), ("expression", TXT(1, 2000)),
  ("variables", '{ type: array, maxItems: 30, items: { $ref: "#/components/schemas/FormulaVariable" } }'),
  ("examples", ARR("FormulaPreviewExampleInput", 10)), ("edgeCases", BOOL)], required=[]))
schemas.append(obj("FormulaPreviewUnit", None, [("kind", '{ oneOf: [{ $ref: "#/components/schemas/FormulaKind" }, { type: "null" }] }'), ("currency", NCUR),
  ("period", '{ oneOf: [{ $ref: "#/components/schemas/FormulaPeriod" }, { type: "null" }] }'), ("unitLabel", NSTR)]))
PSTAT = ENUM("ok", "not_computable")
schemas.append(obj("FormulaPreviewOutcome", "A not_computable result has result null and a reasonCode (formula.missing_input, formula.division_by_zero, formula.result_out_of_range); it is shown as 'Not computable', never 0.", [
  ("label", STR), ("inputs", '{ type: object, additionalProperties: { $ref: "#/components/schemas/NullableDecimal" } }'), ("status", PSTAT), ("result", NDEC), ("reasonCode", NSTR)]))
schemas.append(obj("FormulaPreviewEdgeCase", None, [("variable", STR), ("case", ENUM("zero", "missing", "negative")), ("status", PSTAT), ("result", NDEC), ("reasonCode", NSTR)]))
schemas.append(obj("FormulaPreviewProblem", None, [("code", STR), ("message", STR), ("pointer", NSTR)]))
schemas.append(obj("FormulaPreviewResult", None, [("valid", BOOL), ("errors", ARR("FormulaPreviewProblem")), ("unit", REF("FormulaPreviewUnit")),
  ("examples", ARR("FormulaPreviewOutcome")), ("edgeCases", ARR("FormulaPreviewEdgeCase")), ("engineVersion", STR)]))
# financial metrics
TIMING = '{ type: [string, "null"], enum: [end_of_period, beginning_of_period, null] }'
BASIS = '{ type: [string, "null"], enum: [annual, quarterly, monthly, null] }'
schemas.append(obj("FinancialMetricSettings", "An extension, not a playbook requirement (M0174). Off by default; version 0 when never configured. discountRate is a decimal fraction per period of periodBasis (\\\"0.100000\\\" = 10%).", [
  ("enabled", BOOL), ("methodology", ENUM("discounted_net_cash_flow")), ("methodologyNote", NSTR), ("timing", TIMING), ("periodBasis", BASIS), ("discountRate", NDEC),
  ("assumptionsSetBy", NU), ("assumptionsSetAt", NTS), ("enabledChangedBy", NU), ("enabledChangedAt", NTS), ("extension", "{ type: boolean, const: true }"), ("version", INT0)]))
schemas.append(obj("FinancialMetricEnablement", None, [("enabled", BOOL)]))
schemas.append(obj("FinancialMetricAssumptions", None, [("methodologyNote", TXT(3, 2000)), ("timing", ENUM("end_of_period", "beginning_of_period")),
  ("periodBasis", ENUM("annual", "quarterly", "monthly")), ("discountRate", NDEC)]))
schemas.append(obj("CashFlowRow", None, [("periodIndex", "{ type: integer, minimum: 0, maximum: 120 }"), ("outflow", DEC), ("inflow", DEC), ("note", NTXT(1, 500))], required=["periodIndex", "outflow", "inflow"]))
schemas.append(obj("BusinessCaseCashFlows", None, [("businessCaseId", U), ("currency", CUR), ("revision", INT0), ("basisNote", NSTR), ("rows", ARR("CashFlowRow", 121)), ("version", INT0), ("updatedAt", NTS)]))
schemas.append(obj("BusinessCaseCashFlowsPut", None, [("basisNote", NTXT(1, 2000)), ("rows", "{ type: array, minItems: 1, maxItems: 121, items: { $ref: \"#/components/schemas/CashFlowRow\" } }")], required=["rows"]))
schemas.append(obj("FinancialMetrics", "Computed on read with decimal arithmetic; a metric that is not shown or not computable is null with its reason, never 0 (ADR-0047 §5).", [
  ("businessCaseId", U), ("status", ENUM("shown", "disabled", "assumptions_missing", "cash_flows_missing")), ("currency", CUR),
  ("npv", NDEC), ("npvReason", '{ type: [string, "null"], enum: [discount_rate_missing, not_shown, null] }'),
  ("roi", NDEC), ("roiReason", '{ type: [string, "null"], enum: [not_computable, not_shown, null] }'),
  ("paybackPeriodIndex", NINT), ("paybackReason", '{ type: [string, "null"], enum: [not_reached, not_computable, not_shown, null] }'),
  ("assumptions", '{ oneOf: [{ $ref: "#/components/schemas/FinancialMetricAssumptions" }, { type: "null" }] }'), ("cashFlowRevision", NINT), ("extension", "{ type: boolean, const: true }")]))
schemas.append(page("FinancialMetricsPage", "FinancialMetrics"))
# launch plan
WINDOW = ENUM("days_0_30", "days_31_60", "days_61_90")
TSTAT = ENUM("not_started", "in_progress", "completed", "cancelled")
OUTT = '{ type: [string, "null"], enum: [charter, diagnostic_item, baseline, north_star, kpi_definition, tom_canvas_cell, initiative, business_case, roadmap_wave, benefit, evidence, meeting_series, null] }'
schemas.append(obj("LaunchTemplateItem", None, [("code", STR), ("itemKind", ENUM("action", "output", "day_ninety_test")), ("ordinal", INT), ("textEn", STR), ("textAr", STR),
  ("outputRecordType", OUTT), ("startDay", INT), ("dueDay", INT), ("sourceRef", STR)]))
schemas.append(obj("LaunchWindow", None, [("code", WINDOW), ("ordinal", INT), ("labelEn", STR), ("labelAr", STR), ("objectiveEn", STR), ("objectiveAr", STR),
  ("actionsSourceEn", STR), ("outputsSourceEn", STR), ("startDay", INT), ("endDay", INT), ("items", ARR("LaunchTemplateItem"))]))
schemas.append(obj("LaunchPlanTemplate", "Verbatim B0134 (and B0135) texts; the Arabic texts are provisional translations.", [("windows", ARR("LaunchWindow")), ("sourceRef", STR)]))
schemas.append(obj("LaunchPlan", None, [("id", U), ("transformationId", U), ("startDate", BD), ("templateRef", STR), ("generatedVia", ENUM("request", "automation")),
  ("lastShiftDays", NINT), ("taskCount", INT0), ("completedCount", INT0), ("version", VER), ("createdAt", TS), ("updatedAt", TS)]))
schemas.append(obj("LaunchPlanCreate", None, [("startDate", BD)]))
schemas.append(obj("LaunchPlanUpdate", None, [("startDate", BD)]))
schemas.append(obj("LaunchTaskRef", None, [("taskId", U), ("ordinal", INT), ("title", STR), ("status", TSTAT)]))
schemas.append(obj("LaunchTask", "blockedBy lists the active predecessors that are not completed ('Blocked by'). nonWorkingDay is true when the due date is not a working day (shown as a warning, never shifted; D-142 Q6).", [
  ("id", U), ("planId", U), ("ordinal", INT), ("templateItemCode", NSTR), ("windowCode", WINDOW), ("taskKind", ENUM("action", "output", "day_ninety_test", "custom")),
  ("title", STR), ("sourceTextEn", NSTR), ("notes", NSTR), ("startDate", BD), ("dueDate", BD), ("nonWorkingDay", BOOL), ("ownerUserId", NU), ("status", TSTAT),
  ("completedAt", NTS), ("completedBy", NU), ("outputRecordType", OUTT), ("outputRecordId", NU), ("predecessors", ARR("LaunchTaskRef", 20)),
  ("blockedBy", ARR("LaunchTaskRef", 20)), ("version", VER), ("updatedAt", TS)]))
schemas.append(page("LaunchTaskPage", "LaunchTask"))
schemas.append(obj("LaunchTaskCreate", None, [("windowCode", WINDOW), ("title", TXT(1, 300)), ("notes", NTXT(1, 4000)), ("startDate", BD), ("dueDate", BD), ("ownerUserId", NU)],
  required=["windowCode", "title", "startDate", "dueDate"]))
schemas.append(obj("LaunchTaskUpdate", None, [("title", TXT(1, 300)), ("notes", NTXT(1, 4000)), ("startDate", BD), ("dueDate", BD), ("ownerUserId", NU),
  ("status", TSTAT), ("outputRecordType", OUTT), ("outputRecordId", NU)], required=[], extra="      minProperties: 1\n"))
schemas.append(obj("LaunchTaskPredecessors", None, [("predecessorTaskIds", "{ type: array, maxItems: 20, uniqueItems: true, items: " + U + " }")]))
# Day-90 test
schemas.append(obj("DayNinetyEvidenceSuggestion", "A record the platform suggests as evidence; the leader confirms it. Never an answer.", [("recordType", STR), ("recordId", U), ("label", STR), ("state", NSTR)]))
schemas.append(obj("DayNinetyResponse", None, [("answer", ENUM("yes", "no")), ("comment", NSTR), ("evidenceId", NU), ("respondedBy", U), ("updatedAt", TS)]))
schemas.append(obj("DayNinetyQuestion", None, [("code", STR), ("ordinal", INT), ("textEn", STR), ("textAr", STR), ("sourceRef", STR),
  ("response", '{ oneOf: [{ $ref: "#/components/schemas/DayNinetyResponse" }, { type: "null" }] }'), ("evidenceSuggestions", ARR("DayNinetyEvidenceSuggestion", 5))]))
schemas.append(obj("Completion", "answered of total; complete only when every question is answered (an incomplete record shows no result).", [("answered", INT0), ("total", INT), ("complete", BOOL)]))
schemas.append(obj("DayNinetyTest", None, [("id", U), ("planId", U), ("scheduledDate", BD), ("status", ENUM("open", "completed")), ("completion", REF("Completion")),
  ("questions", ARR("DayNinetyQuestion", 6)), ("completedAt", NTS), ("completedBy", NU), ("version", VER)]))
schemas.append(obj("DayNinetyResponsePut", None, [("answer", ENUM("yes", "no")), ("comment", NTXT(1, 2000)), ("evidenceId", NU)], required=["answer"]))
# health check
RESP = ENUM("yes", "no", "partial", "na")
schemas.append(obj("HealthCheckQuestion", None, [("code", STR), ("ordinal", INT), ("textEn", STR), ("textAr", STR), ("sourceRef", STR)]))
schemas.append(obj("HealthCheckQuestionList", "The 25 questions verbatim (B0150); the Arabic texts are provisional translations.", [("items", ARR("HealthCheckQuestion"))]))
schemas.append(obj("HealthCheckBand", None, [("key", STR), ("minScore", DEC), ("rangeLabel", STR), ("textEn", STR), ("textAr", STR), ("origin", ENUM("source", "admin"))]))
schemas.append(obj("HealthCheckResponseOption", None, [("key", RESP), ("credit", NDEC), ("labelEn", NSTR), ("labelAr", NSTR)]))
schemas.append(obj("HealthCheckScheme", "A published scoring scheme version (configuration kind health_check_scheme). implementationAssumption is true for v1 (Yes = 1, No = 0; M0262).", [
  ("versionId", U), ("key", STR), ("versionNo", INT), ("titleEn", STR), ("titleAr", STR), ("scoreBasis", ENUM("points", "percent_of_applicable")),
  ("questionCount", INT), ("implementationAssumption", BOOL), ("responses", ARR("HealthCheckResponseOption", 4)), ("bands", ARR("HealthCheckBand", 20)), ("publishedAt", TS)]))
schemas.append(obj("HealthCheckSchemeList", None, [("items", ARR("HealthCheckScheme"))]))
schemas.append(obj("HealthCheckAnswer", None, [("questionCode", STR), ("response", RESP), ("evidenceNote", NSTR), ("evidenceId", NU), ("ownerUserId", NU),
  ("actionNote", NSTR), ("answeredBy", U), ("updatedAt", TS)]))
schemas.append(obj("HealthCheckAction", None, [("rank", "{ type: integer, minimum: 1, maximum: 3 }"), ("actionText", TXT(1, 1000)), ("ownerUserId", NU),
  ("dueDate", NBD), ("improvementItemId", NU)], required=["rank", "actionText"]))
HC_PROPS = [("id", U), ("transformationId", U), ("sequenceNo", INT), ("schemeVersionId", U), ("schemeVersionNo", INT), ("assessmentDate", BD), ("ownerUserId", U),
  ("status", ENUM("draft", "submitted")), ("completion", REF("Completion")), ("score", NDEC), ("scoreMax", NDEC),
  ("band", '{ oneOf: [{ $ref: "#/components/schemas/HealthCheckBand" }, { type: "null" }] }'), ("scoringAssumption", BOOL), ("previousAssessmentId", NU),
  ("submittedAt", NTS), ("submittedBy", NU), ("version", VER), ("createdAt", TS), ("updatedAt", TS)]
schemas.append(obj("HealthCheckSummary", "score and band are null while the assessment is incomplete (REQ-S14-002).", HC_PROPS))
schemas.append(page("HealthCheckPage", "HealthCheckSummary"))
schemas.append(obj("HealthCheck", "score and band are null while the assessment is incomplete (REQ-S14-002); a complete draft shows its computed score and band, fixed only on submission.", HC_PROPS + [
  ("answers", ARR("HealthCheckAnswer", 25)), ("actions", ARR("HealthCheckAction", 3))]))
schemas.append(obj("HealthCheckCreate", None, [("assessmentDate", BD), ("ownerUserId", NU)], required=["assessmentDate"]))
schemas.append(obj("HealthCheckUpdate", None, [("assessmentDate", BD), ("ownerUserId", U)], required=[], extra="      minProperties: 1\n"))
schemas.append(obj("HealthCheckAnswerPut", None, [("response", RESP), ("evidenceNote", NTXT(1, 2000)), ("evidenceId", NU), ("ownerUserId", NU), ("actionNote", NTXT(1, 1000))], required=["response"]))
schemas.append(obj("HealthCheckActionsPut", None, [("actions", "{ type: array, minItems: 1, maxItems: 3, items: { $ref: \"#/components/schemas/HealthCheckAction\" } }")]))

anchor = "\n  schemas:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + "".join(schemas), 1)
open(F, "w").write(s)
print("operations added:", sum(p.count("operationId:") for p in paths))
