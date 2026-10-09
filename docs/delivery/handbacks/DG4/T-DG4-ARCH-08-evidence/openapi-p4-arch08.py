#!/usr/bin/env python3
"""T-DG4-ARCH-08: generates the slices J and K OpenAPI additions (ADR-0037, ADR-0038) and inserts them into
docs/api/openapi.yaml. Provenance only: run once by the solution-architect; the YAML file is the contract.
The op()/render_paths()/render_params()/page() and schema helpers are copied from the T-DG4-ARCH-07 generator.

  python3 docs/delivery/handbacks/DG4/T-DG4-ARCH-08-evidence/openapi-p4-arch08.py docs/api/openapi.yaml

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
NTS = '{ $ref: "#/components/schemas/NullableTimestamp" }'
BD = '{ $ref: "#/components/schemas/BusinessDate" }'
NBD = '{ $ref: "#/components/schemas/NullableBusinessDate" }'
V = '{ $ref: "#/components/schemas/Version" }'
D = '{ $ref: "#/components/schemas/Decimal" }'
ND = '{ $ref: "#/components/schemas/NullableDecimal" }'
PH = '{ $ref: "#/components/schemas/Phase" }'
NPH = '{ oneOf: [{ $ref: "#/components/schemas/Phase" }, { type: "null" }] }'
UUID = U
T = "/api/v1/transformations/{transformationId}"
TP = ["TransformationId"]
RD = dict(forbidden=False, rule=False)
FILTERS = ["TransformationIdsQuery", "OwnerUserIdQuery", "PeriodIdQuery", "DashboardPhaseQuery", "DashboardStatusQuery"]

# ======================================================================================= dashboards (ADR-0037)
op("/api/v1/overview", "get", "getExecutiveOverview", "dashboards",
   "Executive Overview = the executive dashboard (REQ-S03-009, REQ-S13-001): the six T10 areas over the transformations of the organization the caller may read, narrowed by the filters, and one row per transformation (transformation.read per transformation). 404 when the caller holds no grant in the organization; 422 dashboard.period_not_found, dashboard.owner_not_found.",
   query=["OrganizationIdQuery"] + FILTERS, ok_schema="ExecutiveOverview", forbidden=False)
op(T + "/dashboard", "get", "getTransformationDashboard", "dashboards",
   "Template 10 Executive Transformation Dashboard of one transformation: six areas with the area-specific RAG, headlines and items (REQ-PB-062, REQ-PB-063, REQ-PB-064) (transformation.read). 422 dashboard.period_not_found, dashboard.owner_not_found.",
   params=TP, query=["OwnerUserIdQuery", "PeriodIdQuery"], ok_schema="TransformationDashboard", forbidden=False)
op(T + "/workstreams/{workstreamId}/dashboard", "get", "getWorkstreamDashboard", "dashboards",
   "Workstream dashboard: the T10 areas over the workstream's active initiatives; Decisions and People & adoption are not_applicable (REQ-S13-001) (transformation.read). 422 dashboard.workstream_archived, dashboard.period_not_found, dashboard.owner_not_found.",
   params=TP + ["WorkstreamId"], query=["OwnerUserIdQuery", "PeriodIdQuery"], ok_schema="WorkstreamDashboard", forbidden=False)
op("/api/v1/dashboards/finance", "get", "getFinanceDashboard", "dashboards",
   "Finance dashboard: value lines per class, state and currency, gross/cost/net, Finance queue count, non-financial count (n/a), per transformation (REQ-S13-001) (transformation.read per transformation). 422 dashboard.period_not_found, dashboard.owner_not_found.",
   query=["OrganizationIdQuery"] + FILTERS, ok_schema="FinanceDashboard", forbidden=False)
op("/api/v1/dashboards/adoption", "get", "getAdoptionDashboard", "dashboards",
   "Adoption dashboard: the People & adoption area, each linked indicator with its KPI status, open interventions, per transformation (REQ-S13-001) (transformation.read per transformation). 422 dashboard.period_not_found, dashboard.owner_not_found.",
   query=["OrganizationIdQuery"] + FILTERS, ok_schema="AdoptionDashboard", forbidden=False)
op("/api/v1/dashboard-drilldown", "get", "getDashboardDrilldown", "dashboards",
   "Drill-down of one headline number: contributing records (paginated), period, calculation and evidence; zero, unknown and not_applicable are distinct states (REQ-S13-003) (transformation.read in scope). 422 dashboard.metric_subject_mismatch, dashboard.period_not_found, dashboard.owner_not_found.",
   query=["DrilldownMetricQuery", "OrganizationIdQuery"] + FILTERS + ["SubjectIdQuery", "Cursor", "Limit"], ok_schema="DashboardDrilldown", forbidden=False)
op("/api/v1/me/work", "get", "getMyWork", "dashboards",
   "My Work = the personal work dashboard (REQ-S03-008): the caller's own assigned actions, drafts, reviews, approvals, missing updates and other items, with upcoming deadlines; section pages one section (any signed-in user; own items only).",
   query=["MyWorkSectionQuery", "Cursor", "Limit"], ok_schema="MyWork", not_found=False, **RD)
op(T + "/summary", "get", "getWorkspaceHeader", "dashboards",
   "Transformation workspace header: phase, gate readiness, North Star, owners, outcome health, benefits, key decisions and next required actions, each Unknown where the data is missing (REQ-S03-011) (transformation.read).",
   params=TP, ok_schema="WorkspaceHeader", **RD)
op("/api/v1/organizations/{organizationId}/dashboard-rag-policy", "get", "getDashboardRagPolicy", "dashboards",
   "The organization's T10 RAG thresholds; null = the ADR-0037 default, with the effective values and policySource (organization.read). Version 0 when no row exists.",
   params=["OrganizationId"], ok_schema="DashboardRagPolicy", etag=True, **RD)
op("/api/v1/organizations/{organizationId}/dashboard-rag-policy", "put", "putDashboardRagPolicy", "dashboards",
   "Set the T10 RAG thresholds (decimal ratios 0-1, working days 0-250); If-Match \\\"0\\\" creates the row (dashboard.configure; TO, KDS). 422 dashboard_rag_policy.threshold_order.",
   params=["OrganizationId"], body="DashboardRagPolicyUpdate", ok_schema="DashboardRagPolicy", etag=True, if_match=True)

# ======================================================================================= traceability (ADR-0038 §1-§6)
op(T + "/traceability", "get", "getTraceability", "traceability",
   "Traceability view (REQ-PB-044, REQ-S03-006): nodes and edges of the chain diagnosed issue -> gap -> initiative -> deliverable -> capability change -> KPI movement -> benefit, read in place; every node has the href of its record (transformation.read).",
   params=TP, query=["TraceRootTypeQuery", "TraceRootIdQuery", "TraceDirectionQuery", "TraceDepthQuery"], ok_schema="TraceabilityGraph", forbidden=False)
op(T + "/orphans", "get", "getOrphanReport", "traceability",
   "Orphan report: active records missing an upstream or downstream chain link, with the expected step (REQ-PB-044) (transformation.read).",
   params=TP, query=["OrphanRecordTypeQuery", "OrphanMissingQuery", "Cursor", "Limit"], ok_schema="OrphanReportPage", **RD)
op("/api/v1/records/{recordType}/{recordId}/impact", "get", "getRecordImpact", "traceability",
   "Downstream impact of a record (REQ-S03-006): the records reached through the chain (benefits flagged valueAffected) and the dashboards and T10 areas that read them; unreadable records are only counted (transformation.read of the record).",
   params=["RecordTypePath", "RecordIdPath"], query=["Cursor", "Limit"], ok_schema="RecordImpact", **RD)
op(T + "/trace-links", "get", "listTraceLinks", "traceability",
   "Trace links of the transformation (transformation.read).",
   params=TP, query=["Cursor", "Limit", "TraceLinkKindQuery", "TraceRecordIdQuery", "IncludeRemovedQuery"], ok_schema="TraceLinkPage", **RD)
op(T + "/trace-links", "post", "createTraceLink", "traceability",
   "Link two records of the chain with a contribution statement and, into a KPI or benefit, an optional share (traceability.link; TL, BO, WL, TO). 409 trace_link.duplicate; 422 trace_link.pair_not_allowed, record_not_found, record_inactive, share_not_allowed, allocation_exceeds_total.",
   params=TP, body="TraceLinkCreate", ok="201", ok_desc="Created.", ok_schema="TraceLink", etag=True, location=True, dup=True)
op(T + "/trace-links/{traceLinkId}", "get", "getTraceLink", "traceability",
   "One trace link (transformation.read).", params=TP + ["TraceLinkId"], ok_schema="TraceLink", etag=True, **RD)
op(T + "/trace-links/{traceLinkId}", "patch", "updateTraceLink", "traceability",
   "Edit the contribution statement, share or basis (traceability.link). 422 trace_link.not_active, share_not_allowed, allocation_exceeds_total.",
   params=TP + ["TraceLinkId"], body="TraceLinkUpdate", ok_schema="TraceLink", etag=True, if_match=True)
op(T + "/trace-links/{traceLinkId}/remove", "post", "removeTraceLink", "traceability",
   "Remove a trace link with a reason; it leaves its allocation set (traceability.link). 422 trace_link.not_active.",
   params=TP + ["TraceLinkId"], body="ReasonRequest", ok_schema="TraceLink", etag=True, if_match=True)
op(T + "/allocation-sets/{allocationTargetType}/{allocationTargetId}", "get", "getAllocationSet", "traceability",
   "The allocation set into one outcome KPI or benefit: members, decimal total and unallocated share (transformation.read).",
   params=TP + ["AllocationTargetType", "AllocationTargetId"], ok_schema="AllocationSet", **RD)
op("/api/v1/initiatives/{initiativeId}/outcome-contributions/{linkId}/allocation", "post", "setOutcomeContributionAllocation", "traceability",
   "Set or clear the share of a KPI movement credited to a T05 contribution (traceability.link). 422 contribution.allocation_needs_kpi, contribution.not_active, trace_link.allocation_exceeds_total.",
   params=["InitiativeId", "LinkId"], body="ContributionAllocationUpdate", ok_schema="ContributionAllocation", etag=True, if_match=True)

# ======================================================================================= modular entry (ADR-0038 §7)
op(T + "/missing-links", "get", "getMissingLinks", "modular-entry",
   "Missing-link report (REQ-PB-005, REQ-S03-005): blocking and warning items, and G1-G6 labelled approved, inherited or inherited_pending_verification (never approved without a platform decision) (transformation.read).",
   params=TP, ok_schema="MissingLinks", **RD)
op(T + "/inherited-records", "get", "listInheritedRecords", "modular-entry",
   "Inherited evidence and baselines, and the inherited-approval dispensations as read-only prior_approval entries, each labelled inherited (REQ-S03-005) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "IncludeRemovedQuery"], ok_schema="InheritedRecordPage", **RD)
op(T + "/inherited-records", "post", "createInheritedRecord", "modular-entry",
   "Record an inherited evidence item or baseline with its provenance (inherited_record.record; TL, TO). 409 inherited_record.duplicate; 422 inherited_record.not_modular, prior_approval_use_dispensation.",
   params=TP, body="InheritedRecordCreate", ok="201", ok_desc="Created.", ok_schema="InheritedRecord", etag=True, location=True, dup=True)
op(T + "/inherited-records/{inheritedRecordId}/withdraw", "post", "withdrawInheritedRecord", "modular-entry",
   "Withdraw an inherited record with a reason; provenance never changes (inherited_record.record). 422 inherited_record.not_active.",
   params=TP + ["InheritedRecordId"], body="ReasonRequest", ok_schema="InheritedRecord", etag=True, if_match=True)

# ======================================================================================= portfolios (ADR-0038 §9)
OP_ = "/api/v1/organizations/{organizationId}/portfolios"
op(OP_, "get", "listPortfolios", "portfolios",
   "Portfolios of the organization (organization.read).", params=["OrganizationId"], query=["Cursor", "Limit", "IncludeArchivedQuery"], ok_schema="PortfolioPage", **RD)
op(OP_, "post", "createPortfolio", "portfolios",
   "Create a portfolio (portfolio.manage; TO). 409 portfolio.code_taken.",
   params=["OrganizationId"], body="PortfolioCreate", ok="201", ok_desc="Created.", ok_schema="Portfolio", etag=True, location=True, dup=True)
PF, PFP = "/api/v1/portfolios/{portfolioId}", ["PortfolioId"]
op(PF, "get", "getPortfolio", "portfolios", "One portfolio (organization.read).", params=PFP, ok_schema="Portfolio", etag=True, **RD)
op(PF, "patch", "updatePortfolio", "portfolios",
   "Edit or archive a portfolio (portfolio.manage). 409 portfolio.code_taken; 422 portfolio.archived.",
   params=PFP, body="PortfolioUpdate", ok_schema="Portfolio", etag=True, if_match=True)
op(PF + "/transformations", "get", "listPortfolioTransformations", "portfolios",
   "Transformations in the portfolio that the caller may read (organization.read; transformation.read per row).",
   params=PFP, query=["Cursor", "Limit", "IncludeRemovedQuery"], ok_schema="PortfolioTransformationPage", **RD)
op(PF + "/transformations", "post", "addPortfolioTransformation", "portfolios",
   "Place a transformation in the portfolio (portfolio.manage; the transformation must be readable). 422 portfolio.transformation_already_placed, portfolio.archived.",
   params=PFP, body="PortfolioTransformationCreate", ok="201", ok_desc="Created.", ok_schema="PortfolioTransformation", etag=True, location=True)
op(PF + "/transformations/{portfolioTransformationId}/remove", "post", "removePortfolioTransformation", "portfolios",
   "Remove a transformation from the portfolio with a reason (portfolio.manage). 422 membership.not_active.",
   params=PFP + ["PortfolioTransformationId"], body="ReasonRequest", ok_schema="PortfolioTransformation", etag=True, if_match=True)

# ======================================================================================= workstreams (ADR-0038 §9)
op(T + "/workstreams", "get", "listWorkstreams", "workstreams",
   "Workstreams of the transformation (transformation.read).", params=TP, query=["Cursor", "Limit", "IncludeArchivedQuery"], ok_schema="WorkstreamPage", **RD)
op(T + "/workstreams", "post", "createWorkstream", "workstreams",
   "Create a workstream WS-nn (workstream.manage; TL, TO).",
   params=TP, body="WorkstreamCreate", ok="201", ok_desc="Created.", ok_schema="Workstream", etag=True, location=True)
WS, WSP = T + "/workstreams/{workstreamId}", TP + ["WorkstreamId"]
op(WS, "get", "getWorkstream", "workstreams", "One workstream (transformation.read).", params=WSP, ok_schema="Workstream", etag=True, **RD)
op(WS, "patch", "updateWorkstream", "workstreams",
   "Edit or archive a workstream (workstream.manage). 422 workstream.archived.",
   params=WSP, body="WorkstreamUpdate", ok_schema="Workstream", etag=True, if_match=True)
op(WS + "/initiatives", "get", "listWorkstreamInitiatives", "workstreams",
   "Initiatives of the workstream (transformation.read).", params=WSP, query=["Cursor", "Limit", "IncludeRemovedQuery"], ok_schema="WorkstreamInitiativePage", **RD)
op(WS + "/initiatives", "post", "addWorkstreamInitiative", "workstreams",
   "Assign an initiative to the workstream (workstream.manage). 422 workstream.initiative_already_assigned, workstream.archived.",
   params=WSP, body="WorkstreamInitiativeCreate", ok="201", ok_desc="Created.", ok_schema="WorkstreamInitiative", etag=True, location=True)
op(WS + "/initiatives/{workstreamInitiativeId}/remove", "post", "removeWorkstreamInitiative", "workstreams",
   "Remove an initiative from the workstream with a reason (workstream.manage). 422 membership.not_active.",
   params=WSP + ["WorkstreamInitiativeId"], body="ReasonRequest", ok_schema="WorkstreamInitiative", etag=True, if_match=True)

def enum(*v): return "{ type: string, enum: [%s] }" % ", ".join(v)
NODE_TYPES = ("diagnostic_finding", "tom_gap", "initiative", "deliverable", "capability", "outcome", "outcome_kpi", "benefit")
METRICS = ("outcomes.kpi_status", "outcomes.area", "value.planned", "value.forecast", "value.validated", "value.submitted",
           "value.investment", "value.gap", "portfolio.initiatives", "dependencies.open", "decisions.open", "decisions.overdue",
           "adoption.indicators", "finance.pending_validation")
SECTIONS = ("assigned_actions", "drafts", "reviews", "approvals", "missing_updates", "other")
PARAMS = {
    "WorkstreamId": ("workstreamId", "path", UUID),
    "PortfolioId": ("portfolioId", "path", UUID),
    "TraceLinkId": ("traceLinkId", "path", UUID),
    "InheritedRecordId": ("inheritedRecordId", "path", UUID),
    "PortfolioTransformationId": ("portfolioTransformationId", "path", UUID),
    "WorkstreamInitiativeId": ("workstreamInitiativeId", "path", UUID),
    "AllocationTargetType": ("allocationTargetType", "path", enum("outcome_kpi", "benefit")),
    "AllocationTargetId": ("allocationTargetId", "path", UUID),
    "RecordTypePath": ("recordType", "path", enum(*NODE_TYPES, "kpi_definition")),
    "RecordIdPath": ("recordId", "path", UUID),
    "OrganizationIdQuery": ("organizationId", "query", UUID, True),
    "TransformationIdsQuery": ("transformationId", "query", "{ type: array, items: %s, maxItems: 50 }" % UUID),
    "OwnerUserIdQuery": ("ownerUserId", "query", UUID),
    "PeriodIdQuery": ("periodId", "query", UUID),
    "DashboardPhaseQuery": ("phase", "query", PH),
    "DashboardStatusQuery": ("status", "query", '{ $ref: "#/components/schemas/TransformationStatus" }'),
    "DrilldownMetricQuery": ("metric", "query", '{ $ref: "#/components/schemas/DashboardMetric" }', True),
    "SubjectIdQuery": ("subjectId", "query", UUID),
    "MyWorkSectionQuery": ("section", "query", '{ $ref: "#/components/schemas/MyWorkSection" }'),
    "TraceRootTypeQuery": ("rootType", "query", '{ $ref: "#/components/schemas/TraceNodeType" }'),
    "TraceRootIdQuery": ("rootId", "query", UUID),
    "TraceDirectionQuery": ("direction", "query", "{ type: string, enum: [upstream, downstream, both], default: both }"),
    "TraceDepthQuery": ("depth", "query", "{ type: integer, minimum: 1, maximum: 8, default: 8 }"),
    "OrphanRecordTypeQuery": ("recordType", "query", '{ $ref: "#/components/schemas/TraceNodeType" }'),
    "OrphanMissingQuery": ("missing", "query", enum("upstream", "downstream", "both")),
    "TraceLinkKindQuery": ("kind", "query", '{ $ref: "#/components/schemas/TraceLinkKind" }'),
    "TraceRecordIdQuery": ("recordId", "query", UUID),
    "IncludeRemovedQuery": ("includeRemoved", "query", "{ type: boolean, default: false }"),
    "IncludeArchivedQuery": ("includeArchived", "query", "{ type: boolean, default: false }"),
}
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

CUR = "{ type: string, pattern: '^[A-Z]{3}$' }"
NCUR = "{ type: [string, \"null\"], pattern: '^[A-Z]{3}$' }"
OBJ = "{ type: object }"
NOBJ = '{ type: [object, "null"] }'
STR = "{ type: string }"
NSTR = '{ type: [string, "null"] }'
INT0 = "{ type: integer, minimum: 0 }"
NINT0 = '{ type: [integer, "null"], minimum: 0 }'
BOOL = "{ type: boolean }"
def nref(n): return '{ oneOf: [{ $ref: "#/components/schemas/%s" }, { type: "null" }] }' % n
STAMPS = [("version", V), ("createdAt", TS), ("createdBy", NU), ("updatedAt", TS), ("updatedBy", NU)]
RAG = ("green", "amber", "red", "unknown", "stale", "not_applicable")
AREAS = ("outcomes", "value", "portfolio", "dependencies", "decisions", "people_adoption")
EDGE_KINDS = ("issue_gap", "gap_initiative", "initiative_deliverable", "deliverable_capability", "capability_kpi",
              "initiative_kpi", "outcome_kpi_of", "kpi_benefit", "kpi_benefit_measure", "initiative_benefit")
LINK_KINDS = ("issue_gap", "deliverable_capability", "capability_kpi", "kpi_benefit")
MISSING = ("baseline_missing", "outcome_link_missing", "outcome_kpi_missing", "initiative_outcome_link_missing",
           "initiative_gap_link_missing", "benefit_missing", "benefit_outcome_link_missing", "inherited_approval_unverified")

SC = ""
# --- dashboards (ADR-0037)
SC += "    RagStatus:\n      type: string\n      enum: [%s]\n      description: \"Area or row status (ADR-0037 §3). unknown, stale and not_applicable are never shown as green or 0.\"\n" % ", ".join(RAG)
SC += "    T10AreaCode:\n      type: string\n      enum: [%s]\n" % ", ".join(AREAS)
SC += "    DashboardMetric:\n      type: string\n      enum: [%s]\n" % ", ".join(METRICS)
SC += "    MyWorkSection:\n      type: string\n      enum: [%s]\n" % ", ".join(SECTIONS)
SC += obj("DashboardValue", "A headline or item value (ADR-0037 §5): value and zero are known; unknown and not_applicable carry value null and a reasonKey; stale carries the value labelled Stale.", [
    ("state", EN("value", "zero", "unknown", "stale", "not_applicable")), ("value", ND), ("unit", NSTR), ("currency", NCUR), ("reasonKey", NSTR)])
SC += obj("DashboardPeriod", "", [("start", NBD), ("end", NBD), ("asOf", BD), ("label", NSTR)])
SC += obj("DashboardRag", "", [("status", ref("RagStatus")), ("ruleKey", STR), ("ruleParams", OBJ), ("policySource", EN("default", "configured"))])
SC += obj("DashboardHeadline", "", [("metric", ref("DashboardMetric")), ("labelKey", STR), ("value", ref("DashboardValue")),
                                      ("period", nref("DashboardPeriod")), ("drilldownHref", STR)])
SC += obj("DashboardItem", "", [("recordType", STR), ("recordId", U), ("code", NSTR), ("label", NSTR), ("href", STR),
                                 ("rag", '{ oneOf: [{ $ref: "#/components/schemas/RagStatus" }, { type: "null" }] }'), ("dueDate", NBD),
                                 ("value", nref("DashboardValue")), ("ownerUserId", NU), ("flags", arr(STR))])
SC += obj("T10Area", "One Template 10 area (B0095; M0245-M0252): the seeded bilingual labels (Arabic provisional), its RAG with the rule key, headlines and items.", [
    ("code", ref("T10AreaCode")), ("ordinal", "{ type: integer, minimum: 1, maximum: 6 }"), ("sourceAreaEn", STR), ("areaAr", STR),
    ("sourceWhatToShowEn", STR), ("whatToShowAr", STR), ("sourceRagLogicEn", STR), ("ragLogicAr", STR), ("arProvisional", BOOL),
    ("rag", ref("DashboardRag")), ("headlines", arr(ref("DashboardHeadline"))), ("items", arr(ref("DashboardItem")))])
SC += obj("DashboardFilters", "The filters applied server-side (REQ-S13-002), echoed for the chips.", [
    ("organizationId", U), ("transformationIds", arr(U)), ("ownerUserId", NU), ("periodId", NU), ("periodLabel", NSTR),
    ("phase", NPH), ("status", nref("TransformationStatus")), ("windowStart", NBD), ("windowEnd", NBD), ("asOf", BD)])
SC += obj("AreaStatus", "", [("code", ref("T10AreaCode")), ("status", ref("RagStatus"))])
SC += obj("DashboardTransformationRow", "", [("transformationId", U), ("code", STR), ("name", STR), ("areaStatuses", arr(ref("AreaStatus")))])
SC += obj("TransformationDashboard", "", [("transformationId", U), ("generatedAt", TS), ("businessDate", BD), ("timezone", STR),
                                           ("appliedFilters", ref("DashboardFilters")), ("areas", arr(ref("T10Area"), 6, 6))])
SC += obj("ExecutiveOverview", "", [("organizationId", U), ("generatedAt", TS), ("businessDate", BD), ("appliedFilters", ref("DashboardFilters")),
                                     ("transformationCount", INT0), ("areas", arr(ref("T10Area"), 6, 6)),
                                     ("transformations", arr(ref("DashboardTransformationRow")))])
SC += obj("WorkstreamDashboard", "", [("workstreamId", U), ("transformationId", U), ("code", STR), ("name", STR), ("generatedAt", TS),
                                       ("businessDate", BD), ("appliedFilters", ref("DashboardFilters")), ("areas", arr(ref("T10Area"), 6, 6))])
SC += obj("FinanceValueLine", "", [("valueClass", STR), ("state", EN("planned", "forecast", "measured", "submitted", "validated", "rejected", "sustained")),
                                    ("currency", CUR), ("total", ref("DashboardValue")), ("drilldownHref", NSTR)])
SC += obj("FinanceDashboard", "", [("organizationId", U), ("generatedAt", TS), ("businessDate", BD), ("appliedFilters", ref("DashboardFilters")),
                                    ("lines", arr(ref("FinanceValueLine"))), ("headlines", arr(ref("DashboardHeadline"))),
                                    ("pendingValidationCount", INT0), ("nonFinancialCount", INT0),
                                    ("transformations", arr(ref("DashboardTransformationRow")))])
SC += obj("AdoptionIndicatorRow", "", [("kpiDefinitionId", U), ("templateKey", STR), ("targetKind", STR), ("targetId", NU),
                                        ("rag", ref("RagStatus")), ("value", ref("DashboardValue")), ("drilldownHref", STR)])
SC += obj("AdoptionDashboard", "", [("organizationId", U), ("generatedAt", TS), ("businessDate", BD), ("appliedFilters", ref("DashboardFilters")),
                                     ("area", ref("T10Area")), ("indicators", arr(ref("AdoptionIndicatorRow"))), ("openInterventionCount", INT0),
                                     ("transformations", arr(ref("DashboardTransformationRow")))])
SC += obj("DrilldownItem", "", [("recordType", STR), ("recordId", U), ("code", NSTR), ("label", NSTR), ("href", STR),
                                 ("value", nref("DashboardValue")), ("period", nref("DashboardPeriod"))])
SC += obj("DrilldownInput", "", [("name", STR), ("value", ref("DashboardValue")), ("recordType", NSTR), ("recordId", NU)])
SC += obj("DrilldownEvidence", "", [("evidenceId", U), ("title", STR), ("verificationStatus", STR), ("recordType", STR), ("recordId", U)])
SC += obj("DrilldownCalculation", "", [("ruleKey", STR), ("expression", NSTR), ("inputs", arr(ref("DrilldownInput"))), ("rounding", NOBJ)])
SC += obj("DashboardDrilldown", "Contributing records, period, calculation and evidence of one headline (REQ-S13-003). For a sum metric the decimal sum of items over all pages equals value.", [
    ("metric", ref("DashboardMetric")), ("appliedFilters", ref("DashboardFilters")), ("value", ref("DashboardValue")),
    ("period", nref("DashboardPeriod")), ("calculation", ref("DrilldownCalculation")), ("items", arr(ref("DrilldownItem"))),
    ("evidence", arr(ref("DrilldownEvidence"))), ("nextCursor", NSTR)])
SC += obj("MyWorkItem", "", [("section", ref("MyWorkSection")), ("source", EN("work_item", "action_item", "draft")), ("recordType", STR),
                              ("recordId", U), ("kind", NSTR), ("code", NSTR), ("label", NSTR), ("messageKey", NSTR), ("messageParams", NOBJ),
                              ("transformationId", NU), ("href", STR), ("dueDate", NBD), ("overdue", BOOL)])
SC += obj("MyWorkSectionPage", "", [("section", ref("MyWorkSection")), ("total", INT0), ("items", arr(ref("MyWorkItem"))), ("nextCursor", NSTR)])
SC += obj("MyWork", "The caller's own items only (REQ-S03-008).", [("userId", U), ("generatedAt", TS), ("businessDate", BD), ("horizonWorkingDays", "{ type: integer, minimum: 1 }"),
                                                                  ("sections", arr(ref("MyWorkSectionPage"))), ("upcomingDeadlines", arr(ref("MyWorkItem")))])
SC += obj("UserRef", "", [("userId", U), ("displayName", STR)])
SC += obj("CurrencyValue", "", [("currency", CUR), ("value", ref("DashboardValue"))])
SC += obj("WorkspaceHeader", "The eight elements of M0114 (REQ-S03-011), each with an explicit Unknown.", [
    ("transformationId", U), ("code", STR), ("name", STR),
    ("phase", "{ type: object, required: [currentPhase, mode, entryPhase], additionalProperties: false, properties: { currentPhase: %s, mode: { type: string, enum: [end_to_end, modular] }, entryPhase: %s } }" % (PH, NPH)),
    ("gateReadiness", "{ type: object, required: [state, gateCode, status, inheritedApproval, missingMandatoryCount, ready], additionalProperties: false, properties: { state: { type: string, enum: [known, unknown] }, gateCode: %s, status: %s, inheritedApproval: %s, missingMandatoryCount: %s, ready: { type: [boolean, \"null\"] } } }" % (NSTR, NSTR, nref("GateInheritedApproval"), NINT0)),
    ("northStar", "{ type: object, required: [state, statement, status], additionalProperties: false, properties: { state: { type: string, enum: [known, unknown] }, statement: %s, status: %s } }" % (NSTR, NSTR)),
    ("owners", "{ type: object, required: [sponsor, lead], additionalProperties: false, properties: { sponsor: %s, lead: %s } }" % (nref("UserRef"), nref("UserRef"))),
    ("outcomeHealth", "{ type: object, required: [rag, counts], additionalProperties: false, properties: { rag: %s, counts: %s } }" % (ref("DashboardRag"), arr("{ type: object, required: [status, count], additionalProperties: false, properties: { status: %s, count: %s } }" % (ref("RagStatus"), INT0)))),
    ("benefits", "{ type: object, required: [state, planned, validated, benefitCount, nonFinancialCount], additionalProperties: false, properties: { state: { type: string, enum: [known, unknown] }, planned: %s, validated: %s, benefitCount: %s, nonFinancialCount: %s } }" % (arr(ref("CurrencyValue")), arr(ref("CurrencyValue")), INT0, INT0)),
    ("keyDecisions", "{ type: object, required: [items, overdueCount], additionalProperties: false, properties: { items: %s, overdueCount: %s } }" % (arr(ref("DashboardItem"), None, 5), INT0)),
    ("nextActions", "{ type: object, required: [items, missingMandatoryCount], additionalProperties: false, properties: { items: %s, missingMandatoryCount: %s } }" % (arr(ref("MyWorkItem"), None, 5), NINT0))])
POLICY = [("valueGapAmberRatio", ND), ("valueGapRedRatio", ND), ("milestoneSlipAmberWorkingDays", '{ type: [integer, "null"], minimum: 0, maximum: 250 }'),
          ("milestoneSlipRedWorkingDays", '{ type: [integer, "null"], minimum: 0, maximum: 250 }'), ("dependencyDueSoonWorkingDays", '{ type: [integer, "null"], minimum: 0, maximum: 250 }'),
          ("decisionDueSoonWorkingDays", '{ type: [integer, "null"], minimum: 0, maximum: 250 }'), ("topInitiativeCount", '{ type: [integer, "null"], minimum: 1, maximum: 50 }'),
          ("deadlineHorizonWorkingDays", '{ type: [integer, "null"], minimum: 1, maximum: 250 }')]
SC += obj("DashboardRagPolicyValues", "", [(k, t.replace(', "null"]', "]").replace("NullableDecimal", "Decimal")) for k, t in POLICY])
SC += obj("DashboardRagPolicy", "Configured thresholds (null = the ADR-0037 §3 default) and the effective values; version 0 when no row exists.", [
    ("organizationId", U), ("policySource", EN("default", "configured")), *POLICY, ("note", NSTR), ("effective", ref("DashboardRagPolicyValues")),
    ("version", INT0), ("updatedAt", NTS), ("updatedBy", NU)])
SC += obj("DashboardRagPolicyUpdate", "", [*POLICY, ("note", NS(None, 1, 2000))], required=[])

# --- traceability (ADR-0038)
SC += "    TraceNodeType:\n      type: string\n      enum: [%s]\n" % ", ".join(NODE_TYPES)
SC += "    TraceLinkKind:\n      type: string\n      enum: [%s]\n" % ", ".join(LINK_KINDS)
SC += obj("TraceLink", "", [("id", U), ("transformationId", U), ("linkKind", ref("TraceLinkKind")), ("diagnosticFindingId", NU), ("tomGapId", NU),
                             ("deliverableId", NU), ("capabilityId", NU), ("outcomeKpiId", NU), ("benefitId", NU),
                             ("contributionStatement", STR), ("allocationShare", ND), ("allocationBasis", NSTR),
                             ("status", EN("active", "removed")), ("removedAt", NTS), ("removedBy", NU), ("removeReason", NSTR), *STAMPS])
SC += obj("TraceLinkCreate", "fromId/toId are the two records the kind names (issue_gap: finding -> gap; deliverable_capability: deliverable -> capability; capability_kpi: capability -> outcome KPI; kpi_benefit: outcome KPI -> benefit). allocationShare is a decimal fraction 0 < share <= 1.", [
    ("linkKind", ref("TraceLinkKind")), ("fromId", U), ("toId", U), ("contributionStatement", S(None, 1, 2000)), ("allocationShare", ND), ("allocationBasis", NS(None, 1, 1000))],
    required=["linkKind", "fromId", "toId", "contributionStatement"])
SC += obj("TraceLinkUpdate", "", [("contributionStatement", S(None, 1, 2000)), ("allocationShare", ND), ("allocationBasis", NS(None, 1, 1000))],
          required=[], extra="      minProperties: 1")
SC += page("TraceLinkPage", "TraceLink")
SC += obj("ContributionAllocationUpdate", "", [("allocationShare", ND), ("allocationBasis", NS(None, 1, 1000))])
SC += obj("ContributionAllocation", "", [("linkId", U), ("initiativeId", U), ("outcomeId", U), ("outcomeKpiId", NU), ("allocationShare", ND),
                                          ("allocationBasis", NSTR), ("version", V)])
SC += obj("AllocationSetMember", "", [("linkTable", EN("trace_link", "initiative_outcome_contribution")), ("linkId", U), ("fromType", ref("TraceNodeType")),
                                       ("fromId", U), ("allocationShare", D), ("allocationBasis", NSTR), ("version", V)])
SC += obj("AllocationSet", "The active links into one outcome KPI or benefit that carry a share; total <= 1 (100 %).", [
    ("targetType", EN("outcome_kpi", "benefit")), ("targetId", U), ("members", arr(ref("AllocationSetMember"))), ("total", D), ("unallocatedShare", D)])
SC += obj("TraceNode", "", [("recordType", ref("TraceNodeType")), ("recordId", U), ("code", NSTR), ("label", NSTR), ("status", NSTR), ("href", STR),
                             ("orphan", "{ type: object, required: [upstream, downstream], additionalProperties: false, properties: { upstream: %s, downstream: %s } }" % (BOOL, BOOL)),
                             ("allocation", '{ oneOf: [{ type: object, required: [total, unallocatedShare], additionalProperties: false, properties: { total: %s, unallocatedShare: %s } }, { type: "null" }] }' % (D, D))])
SC += obj("TraceEdge", "", [("edgeKind", EN(*EDGE_KINDS)), ("fromType", STR), ("fromId", U), ("toType", STR), ("toId", U), ("linkTable", STR), ("linkId", U),
                             ("contributionStatement", NSTR), ("allocationShare", ND)])
SC += obj("TraceabilityGraph", "", [("transformationId", U), ("rootType", '{ oneOf: [{ $ref: "#/components/schemas/TraceNodeType" }, { type: "null" }] }'), ("rootId", NU),
                                     ("direction", EN("upstream", "downstream", "both")), ("depth", "{ type: integer, minimum: 1, maximum: 8 }"),
                                     ("nodes", arr(ref("TraceNode"))), ("edges", arr(ref("TraceEdge"))), ("truncated", BOOL)])
SC += obj("OrphanItem", "", [("recordType", ref("TraceNodeType")), ("recordId", U), ("code", NSTR), ("label", NSTR), ("href", STR),
                              ("missing", EN("upstream", "downstream", "both")), ("expected", arr(STR))])
SC += page("OrphanReportPage", "OrphanItem")
SC += obj("ImpactRecord", "", [("recordType", ref("TraceNodeType")), ("recordId", U), ("code", NSTR), ("label", NSTR), ("href", STR),
                                ("distance", "{ type: integer, minimum: 1, maximum: 8 }"), ("edgeKinds", arr(STR)), ("valueAffected", BOOL)])
SC += obj("ImpactDashboardRef", "", [("dashboard", EN("executive", "transformation", "workstream", "finance", "adoption", "personal")),
                                      ("areaCode", '{ oneOf: [{ $ref: "#/components/schemas/T10AreaCode" }, { type: "null" }] }'), ("transformationId", NU), ("workstreamId", NU)])
SC += obj("RecordImpact", "Downstream impact computed on request (ADR-0038 §6); unreadable records are only counted.", [
    ("recordType", STR), ("recordId", U), ("records", arr(ref("ImpactRecord"))), ("dashboards", arr(ref("ImpactDashboardRef"))),
    ("hiddenCount", INT0), ("nextCursor", NSTR)])
SC += obj("MissingLinkItem", "", [("code", EN(*MISSING)), ("severity", EN("blocking", "warning")), ("recordType", NSTR), ("recordId", NU), ("label", NSTR), ("href", NSTR)])
SC += obj("MissingLinksGate", "label is approved only when the platform recorded an approval; an inherited approval is inherited (or inherited_pending_verification), never approved.", [
    ("gateCode", "{ type: string, pattern: '^G[1-6]$' }"), ("status", STR), ("label", STR), ("inheritedApproval", nref("GateInheritedApproval"))])
SC += obj("MissingLinks", "", [("transformationId", U), ("mode", EN("end_to_end", "modular")), ("entryPhase", NPH), ("standaloneDeliverableType", NSTR),
                                ("gates", arr(ref("MissingLinksGate"))), ("items", arr(ref("MissingLinkItem")))])
SC += obj("InheritedRecord", "An inherited item, labelled inherited (\\\"Inherited - recorded, not granted in platform\\\"); prior_approval entries are read-only views of gate dispensations.", [
    ("id", U), ("transformationId", U), ("kind", EN("evidence", "baseline", "prior_approval")), ("label", EN("inherited")), ("evidenceId", NU), ("baselineId", NU),
    ("gateDispensationId", NU), ("gateCode", NSTR), ("approvingBody", NSTR), ("sourceDescription", NSTR), ("originalOwner", NSTR), ("originalDate", NBD),
    ("recordedBy", NU), ("status", STR), ("withdrawnAt", NTS), ("withdrawnBy", NU), ("withdrawReason", NSTR), ("version", V), ("createdAt", TS)])
SC += obj("InheritedRecordCreate", "kind prior_approval is refused (422 inherited_record.prior_approval_use_dispensation): prior approvals are recorded as gate dispensations.", [
    ("kind", EN("evidence", "baseline", "prior_approval")), ("evidenceId", U), ("baselineId", U), ("sourceDescription", S(None, 3, 2000)),
    ("originalOwner", NS(None, 1, 300)), ("originalDate", NBD)], required=["kind", "sourceDescription"])
SC += page("InheritedRecordPage", "InheritedRecord")
PCODE = "{ type: string, pattern: '^[A-Z0-9][A-Z0-9_-]{0,31}$' }"
ARCH = [("status", EN("active", "archived")), ("archivedAt", NTS), ("archivedBy", NU), ("archiveReason", NSTR)]
SC += obj("Portfolio", "", [("id", U), ("organizationId", U), ("code", STR), ("name", STR), ("description", NSTR), ("ownerUserId", NU), *ARCH, *STAMPS])
SC += obj("PortfolioCreate", "", [("code", PCODE), ("name", S(None, 1, 300)), ("description", NS(None, 1, 4000)), ("ownerUserId", NU)], required=["code", "name"])
SC += obj("PortfolioUpdate", "status archived needs archiveReason; an archived portfolio is read-only.", [
    ("code", PCODE), ("name", S(None, 1, 300)), ("description", NS(None, 1, 4000)), ("ownerUserId", NU), ("status", EN("archived")), ("archiveReason", S(None, 3, 1000))],
    required=[], extra="      minProperties: 1")
SC += page("PortfolioPage", "Portfolio")
MEM = [("status", EN("active", "removed")), ("removedAt", NTS), ("removedBy", NU), ("removeReason", NSTR)]
SC += obj("PortfolioTransformation", "", [("id", U), ("portfolioId", U), ("transformationId", U), ("transformationCode", STR), ("transformationName", STR), *MEM, *STAMPS])
SC += obj("PortfolioTransformationCreate", "", [("transformationId", U)])
SC += page("PortfolioTransformationPage", "PortfolioTransformation")
SC += obj("Workstream", "", [("id", U), ("transformationId", U), ("code", "{ type: string, pattern: '^WS-[0-9]{2,6}$' }"), ("name", STR), ("description", NSTR),
                              ("leadUserId", NU), *ARCH, *STAMPS])
SC += obj("WorkstreamCreate", "", [("name", S(None, 1, 300)), ("description", NS(None, 1, 4000)), ("leadUserId", NU)], required=["name"])
SC += obj("WorkstreamUpdate", "status archived needs archiveReason; an archived workstream is read-only.", [
    ("name", S(None, 1, 300)), ("description", NS(None, 1, 4000)), ("leadUserId", NU), ("status", EN("archived")), ("archiveReason", S(None, 3, 1000))],
    required=[], extra="      minProperties: 1")
SC += page("WorkstreamPage", "Workstream")
SC += obj("WorkstreamInitiative", "", [("id", U), ("workstreamId", U), ("initiativeId", U), ("initiativeCode", STR), ("initiativeName", STR), *MEM, *STAMPS])
SC += obj("WorkstreamInitiativeCreate", "", [("initiativeId", U)])
SC += page("WorkstreamInitiativePage", "WorkstreamInitiative")
SC += obj("InitiativeRef", "", [("id", U), ("code", STR), ("name", STR)])
SCHEMAS = SC

TAGS = """  - name: dashboards
    description: Read models over the P4 engines (P4, ADR-0037). Template 10 areas with area-specific RAG, six dashboards, drill-down, My Work, Executive Overview and the workspace header; nothing is stored.
  - name: traceability
    description: The traceability chain, trace links with contribution and allocation rules, orphan report and downstream impact (P4, ADR-0038).
  - name: modular-entry
    description: Modular entry missing-link report and labelled inherited records; inherited approvals are never platform approvals (P4, ADR-0038).
  - name: portfolios
    description: Organization-level portfolios of transformations (P4, ADR-0038).
  - name: workstreams
    description: Workstreams grouping the initiatives of a transformation (P4, ADR-0038).
"""
INFO_ADD = """
    **P4 additions, slices J and K (T-DG4-ARCH-08, ADR-0037, ADR-0038).** Additive within v1. Dashboards, My Work, the
    Executive Overview and the workspace header are read models computed on every request; zero, Unknown, Stale and
    not applicable are distinct states, never shown as 0 or green. Trace links state their contribution; shares into
    one KPI or benefit total at most 100 %. Inherited items are labelled inherited and never become platform approvals.
"""
PERMS = ["traceability.link", "inherited_record.record", "workstream.manage", "portfolio.manage", "dashboard.configure"]
REG_MEMBER = '        version: { $ref: "#/components/schemas/Version" }\n    BenefitLifecycle:\n'
REG_NEW = ('        version: { $ref: "#/components/schemas/Version" }\n'
           '        initiatives:\n'
           '          type: array\n'
           '          items: { $ref: "#/components/schemas/InitiativeRef" }\n'
           '          description: "Optional (ADR-0038 §8): the initiatives of the benefit\'s current allocation set, names read by join (one source of truth)."\n'
           '    BenefitLifecycle:\n')


def main(path):
    s = open(path, encoding="utf-8").read()
    assert "operationId: getExecutiveOverview" not in s, "already applied"
    assert "  version: 1.3.0-p4\n" in s
    for key in PARAMS:
        assert f"\n    {key}:\n" not in s, key
    for line in SCHEMAS.split("\n"):
        if line.startswith("    ") and not line.startswith("     ") and line.endswith(":"):
            assert f"\n{line}\n" not in s, line
    anchor = "    or evidence snapshot. Product gate G6 never implies the engineering gate DG7.\n"
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
    perm_anchor = "        - change_control.configure\n    RoleCode:\n"
    assert s.count(perm_anchor) == 1
    s = s.replace(perm_anchor, "        - change_control.configure\n" + "".join(f"        - {p}\n" for p in PERMS) + "    RoleCode:\n", 1)
    assert s.count(REG_MEMBER) == 1
    s = s.replace(REG_MEMBER, REG_NEW, 1)
    s = s.rstrip("\n") + "\n" + SCHEMAS
    open(path, "w", encoding="utf-8").write(s)
    print(f"added {len(OPS)} operations: " + ", ".join(o["id"] for o in OPS))


if __name__ == "__main__":
    main(sys.argv[1])
