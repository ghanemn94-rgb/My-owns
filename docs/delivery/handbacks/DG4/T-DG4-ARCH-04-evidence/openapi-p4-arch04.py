#!/usr/bin/env python3
"""T-DG4-ARCH-04: generates the slice E OpenAPI additions (ADR-0031) and inserts them into
docs/api/openapi.yaml. Provenance only: run once by the solution-architect; the YAML file is the contract.
The op()/render_paths()/render_params()/page() helpers are copied from the T-DG4-ARCH-03 generator (which added
conflict= for a custom 409 response).

  python3 docs/delivery/handbacks/DG4/T-DG4-ARCH-04-evidence/openapi-p4-arch04.py docs/api/openapi.yaml

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
RE = T + "/raid/{raidEntryId}"
REP = ["TransformationId", "RaidEntryId"]
CC = T + "/corrective-actions/{correctiveCaseId}"
CCP = ["TransformationId", "CorrectiveCaseId"]
I = "/api/v1/initiatives/{initiativeId}"
IP = ["InitiativeId"]
BL = "/api/v1/budget-lines/{budgetLineId}"
BLP = ["BudgetLineId"]

# ----------------------------------------------------------------------------------------------- RAID (ADR-0031 §1-§3)
op(T + "/raid", "get", "listRaidEntries", "raid",
   "The T15 RAID log (REQ-PB-079): Risk, Assumption and Issue rows and the canonical T08 dependencies as Dependency entries, one register with no copy (REQ-PB-078); Probability is n/a (null) except for a Risk (transformation.read).",
   params=TP, query=["Cursor", "Limit", "RaidTypeQuery", "RaidStatusQuery", "RaidOwnerUserIdQuery"], ok_schema="RaidEntryPage", forbidden=False, rule=False)
op(T + "/raid", "post", "createRaidEntry", "raid",
   "Log a RAID entry, status Open (raid.edit; TL, WL, TO; a Dependency entry also needs dependency.edit and is created as the canonical T08 dependency, code DEP-nn). 400 raid.type_invalid (Type outside Risk/Assumption/Issue/Dependency); 422 raid.probability_required, raid.probability_not_applicable.",
   params=TP, body="RaidEntryCreate", ok="201", ok_desc="Created (Open).", ok_schema="RaidEntry", etag=True, location=True, dup=True)
op(RE, "get", "getRaidEntry", "raid", "Read one RAID entry; a Dependency entry is read from its canonical dependency row (transformation.read).",
   params=REP, ok_schema="RaidEntry", etag=True, forbidden=False, rule=False)
op(RE, "patch", "updateRaidEntry", "raid",
   "Change a RAID entry's T15 fields or move it between Open and In progress (raid.edit; a Dependency entry also needs dependency.edit and changes the canonical row). 422 raid.probability_required, raid.probability_not_applicable, raid.status_transition, raid.closed.",
   params=REP, body="RaidEntryUpdate", ok_schema="RaidEntry", etag=True, if_match=True)
op(RE + "/close", "post", "closeRaidEntry", "raid",
   "Close a RAID entry with a closure note; final (raid.edit; a Dependency entry also needs dependency.edit and becomes resolved). 422 raid.closed.",
   params=REP, body="RaidEntryClose", ok_schema="RaidEntry", etag=True, if_match=True)
op(RE + "/actions", "get", "listRaidEntryActions", "raid", "The actions linked to a RAID entry (transformation.read).",
   params=REP, query=["Cursor", "Limit"], ok_schema="RaidActionPage", forbidden=False, rule=False)
op(RE + "/actions", "post", "createRaidEntryAction", "raid",
   "Create an owned action linked to a RAID entry (action.edit, or action.update_own for an action the caller owns). 422 raid.closed.",
   params=REP, body="RaidActionCreate", ok="201", ok_desc="Created.", ok_schema="RaidAction", etag=True, location=True, dup=True)
op(T + "/raid-decision-log", "get", "getRaidDecisionLog", "raid",
   "The integrated RAID and decision log (B0126; REQ-PB-078): open RAID entries and open design (T04) and executive (T16) decisions, read from their canonical records (transformation.read).",
   params=TP, query=["Cursor", "Limit"], ok_schema="RaidDecisionLogPage", forbidden=False, rule=False)

# ----------------------------------------------------------------------------------------------- actions (ADR-0031 §4)
op(T + "/action-register", "get", "listActionRegister", "actions",
   "Every action of the transformation with its source (workshop, RAID entry, dependency, corrective case) and follow-up date; the DG2 action operations are unchanged (transformation.read).",
   params=TP, query=["Cursor", "Limit", "ActionSourceKindQuery", "RaidOwnerUserIdQuery", "ActionStatusQuery", "OverdueQuery"], ok_schema="RaidActionPage", forbidden=False, rule=False)
op(T + "/action-register/{actionItemId}", "get", "getActionRegisterItem", "actions", "Read one action with its source and follow-up date (transformation.read).",
   params=["TransformationId", "ActionItemId"], ok_schema="RaidAction", etag=True, forbidden=False, rule=False)
op(T + "/action-register/{actionItemId}", "patch", "updateActionRegisterItem", "actions",
   "Update an action, including its follow-up date (action.edit, or action.update_own for the owner); status changes follow the DG2 transitions (422 invalid-transition).",
   params=["TransformationId", "ActionItemId"], body="RaidActionUpdate", ok_schema="RaidAction", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- corrective cases (ADR-0031 §5)
op(T + "/corrective-actions", "get", "listCorrectiveCases", "corrective-actions",
   "Corrective-action cases (recovery plans) of the transformation, from KPI deviations, benefit variances, failed adoption or control checks, and Value Review findings (transformation.read).",
   params=TP, query=["Cursor", "Limit", "CorrectiveSourceKindQuery", "CorrectiveStatusQuery", "RaidOwnerUserIdQuery"], ok_schema="CorrectiveCasePage", forbidden=False, rule=False)
op(T + "/corrective-actions", "post", "createCorrectiveCase", "corrective-actions",
   "Open a corrective-action case for a Value Review finding with owner and follow-up date (corrective_action.manage; BO, TL, FIN). 409 corrective_case.already_open (an open case for the same finding); 422 corrective_case.follow_up_past.",
   params=TP, body="CorrectiveCaseCreate", ok="201", ok_desc="Created (Open).", ok_schema="CorrectiveCase", etag=True, location=True, dup=True)
op(CC, "get", "getCorrectiveCase", "corrective-actions", "Read one corrective-action case, with the benefit's lifecycle step when the source is a benefit (transformation.read).",
   params=CCP, ok_schema="CorrectiveCase", etag=True, forbidden=False, rule=False)
op(CC, "patch", "updateCorrectiveCase", "corrective-actions",
   "Change the recovery plan, owner, follow-up date or move between Open and In progress (corrective_action.manage). 422 corrective_case.status_transition, corrective_case.closed, corrective_case.follow_up_past.",
   params=CCP, body="CorrectiveCaseUpdate", ok_schema="CorrectiveCase", etag=True, if_match=True)
op(CC + "/close", "post", "closeCorrectiveCase", "corrective-actions",
   "Close a case with a closure note; final (corrective_action.manage). 422 corrective_case.owner_required, corrective_case.closed.",
   params=CCP, body="CorrectiveCaseClose", ok_schema="CorrectiveCase", etag=True, if_match=True)
op(CC + "/signals", "get", "listCorrectiveCaseSignals", "corrective-actions",
   "The source signals that created or updated the case, newest first (append-only lineage; transformation.read).",
   params=CCP, query=["Cursor", "Limit"], ok_schema="CorrectiveSignalPage", forbidden=False, rule=False)
op(CC + "/actions", "get", "listCorrectiveCaseActions", "corrective-actions", "The actions linked to a corrective-action case (transformation.read).",
   params=CCP, query=["Cursor", "Limit"], ok_schema="RaidActionPage", forbidden=False, rule=False)
op(CC + "/actions", "post", "createCorrectiveCaseAction", "corrective-actions",
   "Create an owned recovery action linked to the case (action.edit, or action.update_own for an action the caller owns). 422 corrective_case.closed.",
   params=CCP, body="RaidActionCreate", ok="201", ok_desc="Created.", ok_schema="RaidAction", etag=True, location=True, dup=True)
op(T + "/corrective-action-rules", "get", "listCorrectiveActionRules", "corrective-actions",
   "The severity and persistence rule in force for each of the four source kinds; isDefault marks a kind without a stored rule (transformation.read).",
   params=TP, query=["Cursor", "Limit"], ok_schema="CorrectiveActionRulePage", forbidden=False, rule=False)
op(T + "/corrective-action-rules", "post", "createCorrectiveActionRule", "corrective-actions",
   "Store the rule of one source kind (corrective_rule.configure; TL, TO). 409 corrective_rule.exists; 422 corrective_rule.severity_kpi_only, corrective_rule.persistence_series_only.",
   params=TP, body="CorrectiveActionRuleCreate", ok="201", ok_desc="Created.", ok_schema="CorrectiveActionRule", etag=True, location=True, dup=True)
op(T + "/corrective-action-rules/{sourceKind}", "patch", "updateCorrectiveActionRule", "corrective-actions",
   "Change the stored rule of one source kind (corrective_rule.configure); 404 when the kind has no stored rule. 422 corrective_rule.severity_kpi_only, corrective_rule.persistence_series_only.",
   params=["TransformationId", "CorrectiveSourceKindPath"], body="CorrectiveActionRuleUpdate", ok_schema="CorrectiveActionRule", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- budget and execution (ADR-0031 §7)
op(I + "/budget-lines", "get", "listBudgetLines", "budget-lines",
   "The initiative's budget lines: budget, actual and forecast as decimal strings in the line's currency; null is Unknown, never 0 (transformation.read).",
   params=IP, query=["Cursor", "Limit", "BudgetLineStatusQuery"], ok_schema="BudgetLinePage", forbidden=False, rule=False)
op(I + "/budget-lines", "post", "createBudgetLine", "budget-lines",
   "Create a budget line; its currency is the organization default at creation (budget.edit; TL, FIN). 409 budget_line.duplicate; 422 budget_line.amount_invalid, budget_line.period_invalid.",
   params=IP, body="BudgetLineCreate", ok="201", ok_desc="Created.", ok_schema="BudgetLine", etag=True, location=True, dup=True)
op(BL, "get", "getBudgetLine", "budget-lines", "Read one budget line (transformation.read).",
   params=BLP, ok_schema="BudgetLine", etag=True, forbidden=False, rule=False)
op(BL, "patch", "updateBudgetLine", "budget-lines",
   "Change a budget line's label, month, amounts, owner or note (budget.edit). 409 budget_line.duplicate or a stale If-Match; 422 budget_line.amount_invalid, budget_line.period_invalid, budget_line.archived.",
   params=BLP, body="BudgetLineUpdate", ok_schema="BudgetLine", etag=True, if_match=True)
op(BL + "/archive", "post", "archiveBudgetLine", "budget-lines", "Archive a budget line with a reason; final (budget.edit). 422 budget_line.archived.",
   params=BLP, body="ReasonRequest", ok_schema="BudgetLine", etag=True, if_match=True)
op(I + "/execution", "get", "getInitiativeExecution", "budget-lines",
   "Execution tracking (REQ-S09-007): approved vs forecast milestone dates with the slip in working days on the business calendar, deliverable acceptance, budget/actual/forecast totals and variances per currency, role-based capacity and FTE demand, dependencies, decisions, and critical-path membership (transformation.read).",
   params=IP, ok_schema="InitiativeExecution", forbidden=False, rule=False)

# ----------------------------------------------------------------------------------------------- schedule network (ADR-0031 §8)
op(T + "/schedule-network", "get", "getScheduleNetwork", "schedule-network",
   "The initiative network on the canonical dependencies with durations in working days and the critical path by the critical path method (zero total float, REQ-S09-009); with any missing duration no critical path is claimed (status not_computable) (transformation.read).",
   params=TP, ok_schema="ScheduleNetwork", forbidden=False, rule=False)
op(I + "/schedule", "post", "createInitiativeSchedule", "schedule-network",
   "Record the initiative's planned duration in working days (roadmap.edit; TL, WL, TO). 409 initiative_schedule.exists.",
   params=IP, body="InitiativeScheduleCreate", ok="201", ok_desc="Created.", ok_schema="InitiativeSchedule", etag=True, location=True, dup=True)
op(I + "/schedule", "patch", "updateInitiativeSchedule", "schedule-network",
   "Change the initiative's planned duration (roadmap.edit); 404 when none is recorded.",
   params=IP, body="InitiativeScheduleUpdate", ok_schema="InitiativeSchedule", etag=True, if_match=True)

UUID = '{ $ref: "#/components/schemas/Uuid" }'
PARAMS = {
    "RaidEntryId": ("raidEntryId", "path", UUID),
    "CorrectiveCaseId": ("correctiveCaseId", "path", UUID),
    "BudgetLineId": ("budgetLineId", "path", UUID),
    "CorrectiveSourceKindPath": ("sourceKind", "path", '{ type: string, enum: [kpi_deviation, benefit_variance, adoption_check, control_check] }'),
    "RaidTypeQuery": ("type", "query", '{ $ref: "#/components/schemas/RaidEntryType" }'),
    "RaidStatusQuery": ("status", "query", '{ $ref: "#/components/schemas/RaidStatus" }'),
    "RaidOwnerUserIdQuery": ("ownerUserId", "query", UUID),
    "ActionSourceKindQuery": ("sourceKind", "query", '{ type: string, enum: [workshop, raid_entry, dependency, corrective_case, none] }'),
    "ActionStatusQuery": ("status", "query", '{ type: string, enum: [open, in_progress, done, cancelled] }'),
    "OverdueQuery": ("overdue", "query", "{ type: boolean }"),
    "CorrectiveSourceKindQuery": ("sourceKind", "query", '{ $ref: "#/components/schemas/CorrectiveSourceKind" }'),
    "CorrectiveStatusQuery": ("status", "query", '{ type: string, enum: [open, in_progress, closed] }'),
    "BudgetLineStatusQuery": ("status", "query", "{ type: string, enum: [active, archived] }"),
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
    # ---- P4 slice E (T-DG4-ARCH-04; ADR-0031) -----------------------------------------------------------------------
    RaidEntryType:
      type: string
      enum: [risk, assumption, issue, dependency]
      description: "T15 Type (B0128). Any other value is 400 with error code raid.type_invalid (REQ-PB-079)."
    RaidLevel:
      type: string
      enum: [high, medium, low]
      description: T15 H/M/L (B0128).
    RaidStatus:
      type: string
      enum: [open, in_progress, closed]
      description: "T15 Status; new entries are open (B0128). A Dependency entry maps open and at_risk to open, resolved to closed."
    RaidEntry:
      type: object
      description: "One T15 row (B0128). A Dependency entry is the canonical T08 dependency itself (recordTable dependency), never a copy (REQ-PB-078). Probability is null (n/a) unless type is risk (REQ-PB-080); impact null is Unknown."
      required: [id, transformationId, type, code, description, impact, probability, ownerUserId, dueDate, mitigation, status, recordStatus, recordTable, initiativeId, closedAt, closedBy, closureNote, version, createdAt, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        type: { $ref: "#/components/schemas/RaidEntryType" }
        code: { type: string, pattern: "^(R|A|I|DEP)-[0-9]{2,6}$", description: "R-nn, A-nn, I-nn; a Dependency entry keeps its DEP-nn code (D-089 Q5)." }
        description: { type: string, minLength: 1, maxLength: 4000 }
        impact: { oneOf: [{ $ref: "#/components/schemas/RaidLevel" }, { type: "null" }] }
        probability: { oneOf: [{ $ref: "#/components/schemas/RaidLevel" }, { type: "null" }] }
        ownerUserId: { $ref: "#/components/schemas/NullableUuid" }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        mitigation: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        status: { $ref: "#/components/schemas/RaidStatus" }
        recordStatus: { type: string, description: "The canonical row's own status (raid_entry: open, in_progress, closed; dependency: open, at_risk, resolved)." }
        recordTable: { type: string, enum: [raid_entry, dependency] }
        initiativeId: { $ref: "#/components/schemas/NullableUuid" }
        closedAt: { oneOf: [{ $ref: "#/components/schemas/Timestamp" }, { type: "null" }] }
        closedBy: { $ref: "#/components/schemas/NullableUuid" }
        closureNote: { type: [string, "null"], minLength: 3, maxLength: 2000 }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    RaidEntryCreate:
      type: object
      required: [type, description, impact, ownerUserId]
      additionalProperties: false
      properties:
        type: { $ref: "#/components/schemas/RaidEntryType" }
        description: { type: string, minLength: 1, maxLength: 4000 }
        impact: { $ref: "#/components/schemas/RaidLevel" }
        probability: { oneOf: [{ $ref: "#/components/schemas/RaidLevel" }, { type: "null" }], description: "Required for a Risk (422 raid.probability_required); must be absent or null otherwise (422 raid.probability_not_applicable)." }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        mitigation: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        initiativeId: { $ref: "#/components/schemas/NullableUuid" }
        fromInitiativeId: { $ref: "#/components/schemas/NullableUuid", description: "Dependency entries only: the T08 From initiative." }
        toInitiativeId: { $ref: "#/components/schemas/NullableUuid", description: "Dependency entries only: the T08 To initiative." }
        dependencyType: { type: string, pattern: "^[a-z][a-z0-9_]{1,47}$", description: "Dependency entries only: a T08 dependency type code (default other)." }
    RaidEntryUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        description: { type: string, minLength: 1, maxLength: 4000 }
        impact: { $ref: "#/components/schemas/RaidLevel" }
        probability: { oneOf: [{ $ref: "#/components/schemas/RaidLevel" }, { type: "null" }] }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        mitigation: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        initiativeId: { $ref: "#/components/schemas/NullableUuid" }
        status: { type: string, enum: [open, in_progress], description: "Closing is closeRaidEntry (422 raid.status_transition)." }
    RaidEntryClose:
      type: object
      required: [closureNote]
      additionalProperties: false
      properties:
        closureNote: { type: string, minLength: 3, maxLength: 2000 }
    RaidDecisionLogItem:
      type: object
      required: [itemKind, id, code, kind, title, ownerUserId, dueDate, status]
      additionalProperties: false
      properties:
        itemKind: { type: string, enum: [raid_entry, decision] }
        id: { $ref: "#/components/schemas/Uuid" }
        code: { type: string }
        kind: { type: string, enum: [risk, assumption, issue, dependency, design, executive] }
        title: { type: string, description: "The RAID description or the decision title, from the canonical record." }
        ownerUserId: { $ref: "#/components/schemas/NullableUuid" }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        status: { type: string }
    RaidAction:
      type: object
      description: "An owned action (Action, REQ-S16-018) with its P4 source link and follow-up date. Always person-authored."
      required: [id, transformationId, title, description, ownerUserId, dueDate, followUpDate, status, sourceKind, sourceWorkshopItemId, raidEntryId, dependencyId, correctiveCaseId, overdue, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        title: { type: string, minLength: 1, maxLength: 500 }
        description: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        followUpDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        status: { type: string, enum: [open, in_progress, done, cancelled] }
        sourceKind: { type: string, enum: [workshop, raid_entry, dependency, corrective_case, none] }
        sourceWorkshopItemId: { $ref: "#/components/schemas/NullableUuid" }
        raidEntryId: { $ref: "#/components/schemas/NullableUuid" }
        dependencyId: { $ref: "#/components/schemas/NullableUuid" }
        correctiveCaseId: { $ref: "#/components/schemas/NullableUuid" }
        overdue: { type: boolean, description: "Due date before today's business date while open or in progress." }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
        updatedBy: { $ref: "#/components/schemas/Uuid" }
    RaidActionCreate:
      type: object
      required: [title, ownerUserId]
      additionalProperties: false
      properties:
        title: { type: string, minLength: 1, maxLength: 500 }
        description: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        followUpDate: { $ref: "#/components/schemas/NullableBusinessDate" }
    RaidActionUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        title: { type: string, minLength: 1, maxLength: 500 }
        description: { type: [string, "null"], minLength: 1, maxLength: 4000 }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        followUpDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        status: { type: string, enum: [open, in_progress, done, cancelled] }
    CorrectiveSourceKind:
      type: string
      enum: [kpi_deviation, benefit_variance, adoption_check, control_check, value_review]
    CorrectiveCase:
      type: object
      description: "A recovery plan / corrective-action case (REQ-PB-085, REQ-S12-016). At most one case that is not closed per source; a failed check gets one case ever. createdBy is null for a case the worker created (its audit actor is the service)."
      required: [id, transformationId, code, sourceKind, sourceScopeKey, kpiDefinitionId, kpiScopeKind, kpiScopeId, benefitId, benefitLifecycleStep, sourceRecordType, sourceRecordId, title, recoveryPlan, ownerUserId, ownerStatus, followUpDate, followUpUnknownReason, status, consecutiveOffTrack, signalCount, lastSignalAt, closedAt, closedBy, closureNote, createdSource, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string, pattern: "^CA-[0-9]{2,6}$" }
        sourceKind: { $ref: "#/components/schemas/CorrectiveSourceKind" }
        sourceScopeKey: { type: string, minLength: 1, maxLength: 200 }
        kpiDefinitionId: { $ref: "#/components/schemas/NullableUuid" }
        kpiScopeKind: { type: [string, "null"], enum: [transformation, business_unit, initiative, null] }
        kpiScopeId: { $ref: "#/components/schemas/NullableUuid" }
        benefitId: { $ref: "#/components/schemas/NullableUuid" }
        benefitLifecycleStep: { type: [string, "null"], description: "The benefit's current lifecycle step (read, never changed by the case)." }
        sourceRecordType: { type: [string, "null"] }
        sourceRecordId: { $ref: "#/components/schemas/NullableUuid" }
        title: { type: string, minLength: 1, maxLength: 500 }
        recoveryPlan: { type: [string, "null"], minLength: 1, maxLength: 8000 }
        ownerUserId: { $ref: "#/components/schemas/NullableUuid" }
        ownerStatus: { type: string, enum: [assigned, unassigned], description: "unassigned = no owner resolved; shown as a routing error, never skipped." }
        followUpDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        followUpUnknownReason: { type: [string, "null"], enum: [calendar_not_configured, null] }
        status: { type: string, enum: [open, in_progress, closed] }
        consecutiveOffTrack: { type: [integer, "null"], minimum: 0 }
        signalCount: { type: integer, minimum: 0 }
        lastSignalAt: { oneOf: [{ $ref: "#/components/schemas/Timestamp" }, { type: "null" }] }
        closedAt: { oneOf: [{ $ref: "#/components/schemas/Timestamp" }, { type: "null" }] }
        closedBy: { $ref: "#/components/schemas/NullableUuid" }
        closureNote: { type: [string, "null"], minLength: 3, maxLength: 2000 }
        createdSource: { type: string, enum: [api, worker] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/NullableUuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
        updatedBy: { $ref: "#/components/schemas/NullableUuid" }
    CorrectiveCaseCreate:
      type: object
      required: [findingRef, title, ownerUserId, followUpDate]
      additionalProperties: false
      properties:
        findingRef: { type: string, minLength: 1, maxLength: 150, description: "The Value Review finding this case answers; one open case per finding." }
        title: { type: string, minLength: 1, maxLength: 500 }
        recoveryPlan: { type: [string, "null"], minLength: 1, maxLength: 8000 }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        followUpDate: { $ref: "#/components/schemas/BusinessDate" }
    CorrectiveCaseUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        title: { type: string, minLength: 1, maxLength: 500 }
        recoveryPlan: { type: [string, "null"], minLength: 1, maxLength: 8000 }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        followUpDate: { $ref: "#/components/schemas/BusinessDate" }
        status: { type: string, enum: [open, in_progress], description: "Closing is closeCorrectiveCase (422 corrective_case.status_transition)." }
    CorrectiveCaseClose:
      type: object
      required: [closureNote]
      additionalProperties: false
      properties:
        closureNote: { type: string, minLength: 3, maxLength: 2000 }
    CorrectiveSignal:
      type: object
      required: [id, sourceKind, sourceEventKey, periodKey, periodStart, periodEnd, observedRag, offTrack, rulePersistence, consecutiveOffTrack, outcome, correctiveCaseId, receivedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        sourceKind: { type: string, enum: [kpi_deviation, benefit_variance, adoption_check, control_check] }
        sourceEventKey: { type: string }
        periodKey: { type: string }
        periodStart: { $ref: "#/components/schemas/NullableBusinessDate" }
        periodEnd: { $ref: "#/components/schemas/NullableBusinessDate" }
        observedRag: { type: [string, "null"], enum: [green, amber, red, unknown, stale, not_computable, null] }
        offTrack: { type: [boolean, "null"], description: "null = Unknown: neither off track nor recovered." }
        rulePersistence: { type: [integer, "null"] }
        consecutiveOffTrack: { type: [integer, "null"] }
        outcome: { type: string, enum: [recorded, case_created, case_updated, rule_disabled] }
        correctiveCaseId: { $ref: "#/components/schemas/NullableUuid" }
        receivedAt: { $ref: "#/components/schemas/Timestamp" }
    CorrectiveActionRule:
      type: object
      required: [id, sourceKind, minKpiRag, persistenceCycles, followUpWorkingDays, enabled, isDefault, version]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/NullableUuid" }
        sourceKind: { type: string, enum: [kpi_deviation, benefit_variance, adoption_check, control_check] }
        minKpiRag: { type: [string, "null"], enum: [amber, red, null] }
        persistenceCycles: { type: integer, minimum: 1, maximum: 12 }
        followUpWorkingDays: { type: integer, minimum: 1, maximum: 60 }
        enabled: { type: boolean }
        isDefault: { type: boolean, description: "True when no rule is stored and the ADR-0031 §5.2 default applies (id and version null)." }
        version: { type: [integer, "null"], minimum: 1 }
    CorrectiveActionRuleCreate:
      type: object
      required: [sourceKind, persistenceCycles, followUpWorkingDays]
      additionalProperties: false
      properties:
        sourceKind: { type: string, enum: [kpi_deviation, benefit_variance, adoption_check, control_check] }
        minKpiRag: { type: [string, "null"], enum: [amber, red, null] }
        persistenceCycles: { type: integer, minimum: 1, maximum: 12 }
        followUpWorkingDays: { type: integer, minimum: 1, maximum: 60 }
        enabled: { type: boolean }
    CorrectiveActionRuleUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        minKpiRag: { type: [string, "null"], enum: [amber, red, null] }
        persistenceCycles: { type: integer, minimum: 1, maximum: 12 }
        followUpWorkingDays: { type: integer, minimum: 1, maximum: 60 }
        enabled: { type: boolean }
    BudgetLine:
      type: object
      description: "One budget line of an initiative (REQ-S09-007). Amounts are decimal strings in the line's currency, never converted; null is Unknown, never 0."
      required: [id, transformationId, initiativeId, label, periodMonth, currency, budgetAmount, actualAmount, forecastAmount, ownerUserId, note, status, archivedAt, archivedBy, archiveReason, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        initiativeId: { $ref: "#/components/schemas/Uuid" }
        label: { type: string, minLength: 1, maxLength: 200 }
        periodMonth: { $ref: "#/components/schemas/NullableBusinessDate" }
        currency: { $ref: "#/components/schemas/Currency" }
        budgetAmount: { $ref: "#/components/schemas/NullableDecimal" }
        actualAmount: { $ref: "#/components/schemas/NullableDecimal" }
        forecastAmount: { $ref: "#/components/schemas/NullableDecimal" }
        ownerUserId: { $ref: "#/components/schemas/NullableUuid" }
        note: { type: [string, "null"], minLength: 1, maxLength: 2000 }
        status: { type: string, enum: [active, archived] }
        archivedAt: { oneOf: [{ $ref: "#/components/schemas/Timestamp" }, { type: "null" }] }
        archivedBy: { $ref: "#/components/schemas/NullableUuid" }
        archiveReason: { type: [string, "null"] }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
        updatedBy: { $ref: "#/components/schemas/Uuid" }
    BudgetLineCreate:
      type: object
      required: [label]
      additionalProperties: false
      properties:
        label: { type: string, minLength: 1, maxLength: 200 }
        periodMonth: { $ref: "#/components/schemas/NullableBusinessDate" }
        budgetAmount: { $ref: "#/components/schemas/NullableDecimal" }
        actualAmount: { $ref: "#/components/schemas/NullableDecimal" }
        forecastAmount: { $ref: "#/components/schemas/NullableDecimal" }
        ownerUserId: { $ref: "#/components/schemas/NullableUuid" }
        note: { type: [string, "null"], minLength: 1, maxLength: 2000 }
    BudgetLineUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        label: { type: string, minLength: 1, maxLength: 200 }
        periodMonth: { $ref: "#/components/schemas/NullableBusinessDate" }
        budgetAmount: { $ref: "#/components/schemas/NullableDecimal" }
        actualAmount: { $ref: "#/components/schemas/NullableDecimal" }
        forecastAmount: { $ref: "#/components/schemas/NullableDecimal" }
        ownerUserId: { $ref: "#/components/schemas/NullableUuid" }
        note: { type: [string, "null"], minLength: 1, maxLength: 2000 }
    ExecutionAmount:
      type: object
      required: [status, amount, knownAmount, missingCount, reason]
      additionalProperties: false
      description: "A decimal total or variance. known only when every active line of the currency has the operand(s); otherwise unknown with the known part and the number of lines missing it. Never 0 for missing data."
      properties:
        status: { type: string, enum: [known, unknown] }
        amount: { $ref: "#/components/schemas/NullableDecimal" }
        knownAmount: { $ref: "#/components/schemas/NullableDecimal" }
        missingCount: { type: [integer, "null"], minimum: 0 }
        reason: { type: [string, "null"] }
    ExecutionBudgetTotal:
      type: object
      required: [currency, budget, actual, forecast, forecastVariance, actualVariance]
      additionalProperties: false
      properties:
        currency: { $ref: "#/components/schemas/Currency" }
        budget: { $ref: "#/components/schemas/ExecutionAmount" }
        actual: { $ref: "#/components/schemas/ExecutionAmount" }
        forecast: { $ref: "#/components/schemas/ExecutionAmount" }
        forecastVariance: { $ref: "#/components/schemas/ExecutionAmount" }
        actualVariance: { $ref: "#/components/schemas/ExecutionAmount" }
    WorkingDaySlip:
      type: object
      required: [status, value, reason]
      additionalProperties: false
      description: "Forecast slip vs the approved date in working days on the organization's business calendar (ADR-0031 §7); unknown with a reason, never a calendar-day guess."
      properties:
        status: { type: string, enum: [known, unknown] }
        value: { type: [integer, "null"] }
        reason: { type: [string, "null"], enum: [approved_date_missing, forecast_date_missing, calendar_not_configured, range_too_long, null] }
    ExecutionMilestone:
      type: object
      required: [milestoneId, title, approvedDate, forecastDate, status, calendarVarianceDays, slipWorkingDays]
      additionalProperties: false
      properties:
        milestoneId: { $ref: "#/components/schemas/Uuid" }
        title: { type: string }
        approvedDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        forecastDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        status: { type: string, enum: [planned, achieved, missed, cancelled] }
        calendarVarianceDays: { type: [integer, "null"], description: "The DG3 varianceDays (calendar days), unchanged." }
        slipWorkingDays: { $ref: "#/components/schemas/WorkingDaySlip" }
    ExecutionDeliverable:
      type: object
      required: [deliverableId, title, dueDate, acceptanceStatus]
      additionalProperties: false
      properties:
        deliverableId: { $ref: "#/components/schemas/Uuid" }
        title: { type: string }
        dueDate: { $ref: "#/components/schemas/NullableBusinessDate" }
        acceptanceStatus: { type: string, enum: [pending, submitted, accepted, rejected] }
    ExecutionDemand:
      type: object
      required: [resourceDemandId, resourceRoleId, periodMonth, demandFte, status, availableFte, capacityStatus]
      additionalProperties: false
      properties:
        resourceDemandId: { $ref: "#/components/schemas/Uuid" }
        resourceRoleId: { $ref: "#/components/schemas/Uuid" }
        periodMonth: { $ref: "#/components/schemas/BusinessDate" }
        demandFte: { $ref: "#/components/schemas/Fte" }
        status: { type: string, enum: [planned, committed, released, archived] }
        availableFte: { oneOf: [{ $ref: "#/components/schemas/Fte" }, { type: "null" }] }
        capacityStatus: { type: string, enum: [known, unknown], description: "unknown when the role has no active capacity row for the month." }
    ExecutionDependency:
      type: object
      required: [dependencyId, code, direction, status, neededBy, impact]
      additionalProperties: false
      properties:
        dependencyId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string }
        direction: { type: string, enum: [incoming, outgoing] }
        status: { type: string }
        neededBy: { $ref: "#/components/schemas/NullableBusinessDate" }
        impact: { oneOf: [{ $ref: "#/components/schemas/RaidLevel" }, { type: "null" }] }
    ExecutionDecision:
      type: object
      required: [decisionId, code, kind, status, title]
      additionalProperties: false
      properties:
        decisionId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string }
        kind: { type: string, enum: [design, executive, gate] }
        status: { type: string }
        title: { type: string }
    InitiativeExecution:
      type: object
      description: "Execution tracking per initiative (REQ-S09-007), read from the canonical records; nothing is copied."
      required: [initiativeId, calendarId, milestones, deliverables, budgetLineCount, budgetUnknownReason, budgetTotals, demand, dependencies, decisions, onCriticalPath]
      additionalProperties: false
      properties:
        initiativeId: { $ref: "#/components/schemas/Uuid" }
        calendarId: { $ref: "#/components/schemas/NullableUuid" }
        milestones: { type: array, items: { $ref: "#/components/schemas/ExecutionMilestone" } }
        deliverables: { type: array, items: { $ref: "#/components/schemas/ExecutionDeliverable" } }
        budgetLineCount: { type: integer, minimum: 0 }
        budgetUnknownReason: { type: [string, "null"], enum: [no_budget_lines, null] }
        budgetTotals: { type: array, items: { $ref: "#/components/schemas/ExecutionBudgetTotal" } }
        demand: { type: array, items: { $ref: "#/components/schemas/ExecutionDemand" } }
        dependencies: { type: array, items: { $ref: "#/components/schemas/ExecutionDependency" } }
        decisions: { type: array, items: { $ref: "#/components/schemas/ExecutionDecision" } }
        onCriticalPath: { type: [boolean, "null"], description: "null when the critical path is not computable." }
    ScheduleNode:
      type: object
      required: [initiativeId, code, name, durationWorkingDays, earliestStart, earliestFinish, latestStart, latestFinish, totalFloat, critical]
      additionalProperties: false
      properties:
        initiativeId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string }
        name: { type: string }
        durationWorkingDays: { type: [integer, "null"] }
        earliestStart: { type: [integer, "null"], description: "Working-day offset from 0." }
        earliestFinish: { type: [integer, "null"] }
        latestStart: { type: [integer, "null"] }
        latestFinish: { type: [integer, "null"] }
        totalFloat: { type: [integer, "null"] }
        critical: { type: [boolean, "null"], description: "true iff total float is 0; null when not computable (never claimed)." }
    ScheduleEdge:
      type: object
      required: [dependencyId, code, fromInitiativeId, toInitiativeId, critical]
      additionalProperties: false
      properties:
        dependencyId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string }
        fromInitiativeId: { $ref: "#/components/schemas/Uuid" }
        toInitiativeId: { $ref: "#/components/schemas/Uuid" }
        critical: { type: [boolean, "null"] }
    ScheduleMissingDuration:
      type: object
      required: [initiativeId, code, name]
      additionalProperties: false
      properties:
        initiativeId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string }
        name: { type: string }
    ScheduleNetwork:
      type: object
      description: "The critical path by the critical path method on finish-to-start edges with zero lag (ADR-0031 §8). With any missing duration the status is not_computable and nothing is marked critical."
      required: [transformationId, algorithm, status, reason, projectDurationWorkingDays, missingDurations, nodes, edges, criticalPaths, truncated]
      additionalProperties: false
      properties:
        transformationId: { $ref: "#/components/schemas/Uuid" }
        algorithm: { type: string, enum: [cpm-fs/1] }
        status: { type: string, enum: [computed, not_computable] }
        reason: { type: [string, "null"], enum: [missing_durations, no_initiatives, cycle, null] }
        projectDurationWorkingDays: { type: [integer, "null"] }
        missingDurations: { type: array, items: { $ref: "#/components/schemas/ScheduleMissingDuration" } }
        nodes: { type: array, items: { $ref: "#/components/schemas/ScheduleNode" } }
        edges: { type: array, items: { $ref: "#/components/schemas/ScheduleEdge" } }
        criticalPaths: { type: array, maxItems: 20, items: { type: array, items: { $ref: "#/components/schemas/Uuid" } } }
        truncated: { type: boolean }
    InitiativeSchedule:
      type: object
      required: [id, initiativeId, durationWorkingDays, note, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        initiativeId: { $ref: "#/components/schemas/Uuid" }
        durationWorkingDays: { type: [integer, "null"], minimum: 0, maximum: 2600 }
        note: { type: [string, "null"], minLength: 1, maxLength: 2000 }
        version: { $ref: "#/components/schemas/Version" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
        updatedBy: { $ref: "#/components/schemas/Uuid" }
    InitiativeScheduleCreate:
      type: object
      required: [durationWorkingDays]
      additionalProperties: false
      properties:
        durationWorkingDays: { type: [integer, "null"], minimum: 0, maximum: 2600 }
        note: { type: [string, "null"], minLength: 1, maxLength: 2000 }
    InitiativeScheduleUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        durationWorkingDays: { type: [integer, "null"], minimum: 0, maximum: 2600 }
        note: { type: [string, "null"], minLength: 1, maxLength: 2000 }
''' + "".join(page(n, i) for n, i in [
    ("RaidEntryPage", "RaidEntry"), ("RaidActionPage", "RaidAction"), ("RaidDecisionLogPage", "RaidDecisionLogItem"),
    ("CorrectiveCasePage", "CorrectiveCase"), ("CorrectiveSignalPage", "CorrectiveSignal"),
    ("CorrectiveActionRulePage", "CorrectiveActionRule"), ("BudgetLinePage", "BudgetLine")])

TAGS = '''  - name: raid
    description: T15 RAID log on canonical records (Dependency entries are the T08 dependencies) and the integrated RAID and decision log (P4, ADR-0031).
  - name: actions
    description: The action register with source links and follow-up dates; the DG2 action operations are unchanged (P4, ADR-0031).
  - name: corrective-actions
    description: Corrective-action cases (recovery plans), their source signals and the severity and persistence rules (P4, ADR-0031).
  - name: budget-lines
    description: Initiative budget lines (budget, actual, forecast in decimal money) and execution tracking with the working-day slip (P4, ADR-0031).
  - name: schedule-network
    description: Initiative durations and the critical path from defined scheduling logic (P4, ADR-0031).
'''

INFO_ADD = '''
    **P4 additions, slice E (T-DG4-ARCH-04, ADR-0031).** Additive within v1: new paths, schemas and tags. A RAID
    Dependency entry is the canonical T08 dependency (no copy); Probability is n/a except for a Risk. Corrective-action
    cases are opened or updated (never duplicated) by the configured severity and persistence rule. Budget amounts are
    decimal strings and Unknown is never 0. A critical path is claimed only when every duration is known.
'''

PERMS = ["raid.edit", "corrective_action.manage", "corrective_rule.configure", "budget.edit"]


def main(path):
    s = open(path, encoding="utf-8").read()
    assert "operationId: listRaidEntries" not in s, "already applied"
    assert "  version: 1.3.0-p4\n" in s
    for key in PARAMS:
        assert f"\n    {key}:\n" not in s, key
    anchor = "    never add value states, scenarios or allocations together. Finance validation is a decision by a named Finance user.\n"
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
    perm_anchor = "        - benefit_group.manage\n    RoleCode:\n"
    assert s.count(perm_anchor) == 1
    s = s.replace(perm_anchor, "        - benefit_group.manage\n" + "".join(f"        - {p}\n" for p in PERMS) + "    RoleCode:\n", 1)
    s = s.rstrip("\n") + "\n" + SCHEMAS
    open(path, "w", encoding="utf-8").write(s)
    print(f"added {len(OPS)} operations: " + ", ".join(o["id"] for o in OPS))


if __name__ == "__main__":
    main(sys.argv[1])
