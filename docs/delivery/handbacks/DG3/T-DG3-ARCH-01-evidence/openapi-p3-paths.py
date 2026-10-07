# T-DG3-ARCH-01 (solution-architect): generator for the P3 path items of docs/api/openapi.yaml. Kept as provenance:
# every P3 operation gets the same ADR-0007 §5a/§5b statuses (400 always; 401; 403 on unsafe methods; 409/428 with
# If-Match; 429 always), CSRF security on unsafe methods and problem+json errors. Usage: python3 <this> <out-dir>
import json
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TMPDIR", ".")
OPS = []


def ref(n):
    return '{ $ref: "#/components/schemas/%s" }' % n


def R(n):
    return '{ $ref: "#/components/responses/%s" }' % n


def PRM(n):
    return '- $ref: "#/components/parameters/%s"' % n


def op(method, opid, tag, summary, *, query=None, body=None, ok=None, ifmatch=False, create=False, idem=False,
       nf=True, dup=False):
    method = method.lower()
    unsafe = method != "get"
    L = [f"    {method}:", f"      tags: [{tag}]", f"      operationId: {opid}",
         f"      summary: {json.dumps(summary, ensure_ascii=False)}"]
    if unsafe:
        L += ["      security:", "        - sessionCookie: []", "          csrfToken: []"]
    params = []
    if ifmatch:
        params.append(PRM("IfMatch"))
    if idem:
        params.append(PRM("IdempotencyKey"))
    params += query or []
    if params:
        L.append("      parameters:")
        L += ["        " + p for p in params]
    if body:
        L += ["      requestBody:", "        required: true", "        content:", "          application/json:",
              f"            schema: {ref(body)}"]
    L.append("      responses:")
    st, sch, desc = ok
    L.append(f'        "{st}":')
    L.append(f"          description: {json.dumps(desc, ensure_ascii=False)}")
    hdr = []
    if create:
        hdr.append('            Location: { $ref: "#/components/headers/Location" }')
    if create or ifmatch or sch.endswith("!"):
        hdr.append('            ETag: { $ref: "#/components/headers/ETag" }')
    if hdr:
        L.append("          headers:")
        L += hdr
    L += ["          content:", "            application/json:", f"              schema: {ref(sch.rstrip('!'))}"]
    L.append(f'        "400": {R("ValidationError")}')
    L.append(f'        "401": {R("Unauthenticated")}')
    if unsafe:
        L.append(f'        "403": {R("Forbidden")}')
    if nf:
        L.append(f'        "404": {R("NotFound")}')
    if ifmatch:
        L.append(f'        "409": {R("VersionConflict")}')
    elif dup:
        L.append(f'        "409": {R("Duplicate")}')
    if unsafe:
        L.append(f'        "422": {R("BusinessRule")}')
    if ifmatch:
        L.append(f'        "428": {R("PreconditionRequired")}')
    L.append(f'        "429": {R("RateLimited")}')
    OPS.append(opid)
    return L


paths = {}


def add(path, params, *ops):
    d = paths.setdefault(path, {"params": params, "ops": []})
    d["ops"] += ops


TID = PRM("TransformationId")
IID = PRM("InitiativeId")
TQ = '- { name: transformationId, in: query, required: true, schema: { $ref: "#/components/schemas/Uuid" } }'
CUR = PRM("Cursor")
LIM = PRM("Limit")
ARCH = '- { name: includeArchived, in: query, required: false, schema: { type: boolean, default: false } }'
UUIDQ = lambda n: '- { name: %s, in: query, required: false, schema: { $ref: "#/components/schemas/Uuid" } }' % n
STATUSQ = '- { name: status, in: query, required: false, schema: { $ref: "#/components/schemas/InitiativeStatus" } }'

# ---- initiatives (portfolio module) ----
add("/api/v1/initiatives", [],
    op("get", "listInitiatives", "portfolio", "List the initiatives (T05) of one transformation (portfolio module; transformation.read), newest change first, with the derived funding state ('Selected - unfunded') and warnings.",
       query=[TQ, STATUSQ, UUIDQ("waveId"), CUR, LIM], ok=("200", "InitiativePage", "Page (`updatedAt` desc, `id` desc).")),
    op("post", "createInitiative", "portfolio", "Create a draft initiative (initiative.edit). Drafting is allowed at any time, including before G1 (ADR-0021 §3). The code INI-nn is generated.",
       body="InitiativeCreate", ok=("201", "Initiative", "Created (status draft)."), create=True, idem=True, dup=True))
add("/api/v1/initiatives/{initiativeId}", [IID],
    op("get", "getInitiative", "portfolio", "Read one initiative with its warnings (deliverable count outside 3-7, no gap link, no owner) and schedule flags.",
       ok=("200", "Initiative!", "The record.")),
    op("patch", "updateInitiative", "portfolio", "Update T05 fields, wave and planned dates (initiative.edit). The status changes only through the transition actions.",
       body="InitiativeUpdate", ok=("200", "Initiative", "Updated; `version` incremented by one."), ifmatch=True))
for act, opid, perm, desc, bodyn in [
    ("submit", "submitInitiative", "initiative.edit", "draft -> submitted (add to the portfolio; submit for prioritization). 422 invalid-transition `initiative.g1_not_approved` 'Case for change not yet approved (G1): leadership agreement on problem, baseline and material value pools is required before an initiative enters the portfolio'; 422 validation `initiative.outcome_before_activity` 'Outcome before activity: link at least one measurable outcome with a KPI before submitting for prioritization' (ADR-0021 §3)", "TransitionNote"),
    ("withdraw", "withdrawInitiative", "initiative.edit", "submitted|ranked -> draft, with a reason", "ReasonRequest"),
    ("select", "selectInitiative", "portfolio.select", "ranked -> selected: the approved portfolio selection, a business approval recorded as a portfolio_selection row (REQ-S09-003). Ranking never selects; selection never funds", "SelectionRequest"),
    ("deselect", "deselectInitiative", "portfolio.select", "selected|funded -> ranked, with a rationale (not once launched)", "SelectionRequest"),
    ("launch", "launchInitiative", "initiative.launch", "funded -> launched. End-to-End: 422 invalid-transition `initiative.direction_not_approved` 'North Star, outcomes and target state not yet approved' until G2 and G3 are approved or waived; a selected initiative without funding is 422 `initiative.selected_unfunded` 'Selected - unfunded: a funding approval is required before launch' (REQ-PB-004, REQ-S09-003)", "TransitionNote"),
    ("cancel", "cancelInitiative", "initiative.edit", "Any non-terminal status except launched -> cancelled, with a reason", "ReasonRequest")]:
    add(f"/api/v1/initiatives/{{initiativeId}}/{act}", [IID],
        op("post", opid, "portfolio", f"{desc} ({perm}).", body=bodyn,
           ok=("200", "Initiative", "Transitioned; `version` incremented by one."), ifmatch=True))
add("/api/v1/initiatives/{initiativeId}/selections", [IID],
    op("get", "listPortfolioSelections", "portfolio", "Selection history of an initiative (append-only portfolio_selection rows).",
       query=[CUR, LIM], ok=("200", "PortfolioSelectionPage", "Page, newest first.")))
for seg, name, desc in [
    ("gap-links", "InitiativeGapLink", "T05 'Problem / gap addressed': a vehicle link to a T03 gap or a diagnosed finding (`targetType` tom_gap | diagnostic_finding). Any other TOM record type is 422 `initiative.not_tom_evidence` 'A project portfolio is not a Target Operating Model: an initiative cannot be attached as G3 TOM evidence.' (REQ-PB-040)."),
    ("outcome-contributions", "InitiativeOutcomeContribution", "T05 'Outcome/KPI contribution' (level 5 of the outcome hierarchy). `outcomeId` is required: a contribution without an outcome link is rejected (REQ-PB-032)."),
    ("decision-links", "InitiativeDecisionLink", "T05 'Required decisions': link to a canonical decision (one decision model).")]:
    add(f"/api/v1/initiatives/{{initiativeId}}/{seg}", [IID],
        op("get", f"list{name}s", "portfolio", f"List the links. {desc}", query=[ARCH],
           ok=("200", f"{name}List", "All links of the initiative.")),
        op("post", f"create{name}", "portfolio", f"Create (initiative.edit). {desc}", body=f"{name}Create",
           ok=("201", name, "Created."), create=True, dup=True))
    add(f"/api/v1/initiatives/{{initiativeId}}/{seg}/{{linkId}}/remove", [IID, PRM("LinkId")],
        op("post", f"remove{name}", "portfolio", "Remove (never delete) with a reason (initiative.edit).", body="ReasonRequest",
           ok=("200", name, "Removed; `version` incremented by one."), ifmatch=True))
add("/api/v1/initiatives/{initiativeId}/deliverables", [IID],
    op("get", "listDeliverables", "portfolio", "List the key deliverables of an initiative (3-7 recommended; outside is a warning).",
       query=[ARCH], ok=("200", "DeliverableList", "All deliverables in ordinal order.")),
    op("post", "createDeliverable", "portfolio", "Create (initiative.edit).", body="DeliverableCreate",
       ok=("201", "Deliverable", "Created (acceptance pending)."), create=True))
DID = PRM("DeliverableId")
add("/api/v1/deliverables/{deliverableId}", [DID],
    op("get", "getDeliverable", "portfolio", "Read one deliverable.", ok=("200", "Deliverable!", "The record.")),
    op("patch", "updateDeliverable", "portfolio", "Update or archive (initiative.edit); acceptance changes only through the actions.",
       body="DeliverableUpdate", ok=("200", "Deliverable", "Updated."), ifmatch=True))
add("/api/v1/deliverables/{deliverableId}/submit", [DID],
    op("post", "submitDeliverable", "portfolio", "pending|rejected -> submitted for acceptance (initiative.edit).", body="TransitionNote",
       ok=("200", "Deliverable", "Submitted."), ifmatch=True))
add("/api/v1/deliverables/{deliverableId}/acceptance", [DID],
    op("post", "decideDeliverable", "portfolio", "submitted -> accepted | rejected (deliverable.accept and the initiative's executive owner or a delegate; never the submitter).",
       body="AcceptanceDecision", ok=("200", "Deliverable", "Decided."), ifmatch=True))
add("/api/v1/initiatives/{initiativeId}/milestones", [IID],
    op("get", "listMilestones", "portfolio", "List milestones (approved vs forecast dates).", ok=("200", "MilestoneList", "All milestones.")),
    op("post", "createMilestone", "portfolio", "Create (initiative.edit or roadmap.edit).", body="MilestoneCreate",
       ok=("201", "Milestone", "Created."), create=True))
MID = PRM("MilestoneId")
add("/api/v1/milestones/{milestoneId}", [MID],
    op("get", "getMilestone", "roadmap", "Read one milestone.", ok=("200", "Milestone!", "The record.")),
    op("patch", "updateMilestone", "roadmap", "Move the forecast date, set the actual date or status (roadmap.edit). The timeline, table and board read this same record; a stale If-Match is 409 (REQ-S09-006).",
       body="MilestoneUpdate", ok=("200", "Milestone", "Updated."), ifmatch=True))
add("/api/v1/milestones/{milestoneId}/approve-date", [MID],
    op("post", "approveMilestoneDate", "roadmap", "Set the approved (baseline) date with a reason (roadmap.approve).", body="MilestoneDateApproval",
       ok=("200", "Milestone", "Approved date recorded."), ifmatch=True))
add("/api/v1/transformations/{transformationId}/readiness", [TID],
    op("get", "getTransformationReadiness", "portfolio", "Readiness view (REQ-PB-007; DG2 extension on a new path): gate states with inherited approvals and waivers, the B0012 diagnostic areas (economics, customer, operations, capability, technology) mapped to the T01 dimensions, the missing ones, and the sequencing blockers (ADR-0021 §9).",
       ok=("200", "TransformationReadiness", "The readiness view.")))
add("/api/v1/transformations/{transformationId}/outcome-hierarchy", [TID],
    op("get", "getOutcomeHierarchy", "portfolio", "The five B0048 levels as one tree: North Star, strategic outcomes, KPIs (T02 rows), targets and initiative contributions (REQ-PB-032).",
       ok=("200", "OutcomeHierarchy", "The tree.")))
add("/api/v1/transformations/{transformationId}/gate-dispensations", [TID],
    op("get", "listGateDispensations", "portfolio", "Modular inherited approvals and End-to-End waivers (ADR-0021 §5). They never create a gate decision.",
       query=[CUR, LIM], ok=("200", "GateDispensationPage", "Page, newest first.")),
    op("post", "createGateDispensation", "portfolio", "Record an inherited approval (verified evidence required to count) or request a waiver (gate.submit). Pending until another person holding gate.decide accepts it.",
       body="GateDispensationCreate", ok=("201", "GateDispensation", "Recorded (pending)."), create=True))
GDID = PRM("DispensationId")
add("/api/v1/transformations/{transformationId}/gate-dispensations/{dispensationId}/decision", [TID, GDID],
    op("post", "decideGateDispensation", "portfolio", "Accept or reject (gate.decide; for a waiver the gate's configured approver; never the recorder).",
       body="AcceptanceDecision", ok=("200", "GateDispensation", "Decided."), ifmatch=True))
add("/api/v1/transformations/{transformationId}/gate-dispensations/{dispensationId}/revoke", [TID, GDID],
    op("post", "revokeGateDispensation", "portfolio", "Revoke an accepted dispensation with a reason (gate.decide).", body="ReasonRequest",
       ok=("200", "GateDispensation", "Revoked."), ifmatch=True))
# ---- roadmap ----
add("/api/v1/transformations/{transformationId}/waves", [TID],
    op("get", "listRoadmapWaves", "roadmap", "The T07 waves: the four source waves verbatim (B0079) plus added waves; horizons may overlap.",
       ok=("200", "RoadmapWaveList", "All waves in ordinal order.")),
    op("post", "createRoadmapWave", "roadmap", "Add a non-source wave (roadmap.edit).", body="RoadmapWaveCreate",
       ok=("201", "RoadmapWave", "Created."), create=True, dup=True))
add("/api/v1/transformations/{transformationId}/waves/{waveId}", [TID, PRM("WaveId")],
    op("get", "getRoadmapWave", "roadmap", "Read one wave.", ok=("200", "RoadmapWave!", "The record.")),
    op("patch", "updateRoadmapWave", "roadmap", "Update planned dates, owner and notes (roadmap.edit). The verbatim source text of a seeded wave is immutable.",
       body="RoadmapWaveUpdate", ok=("200", "RoadmapWave", "Updated."), ifmatch=True))
add("/api/v1/transformations/{transformationId}/roadmap", [TID],
    op("get", "getRoadmap", "roadmap", "One read model for the timeline, the initiative table and the work board (REQ-S09-006): waves, initiatives, milestones, deliverables and initiative dependencies with versions and schedule flags. No critical-path claim (ADR-0023 §5).",
       ok=("200", "RoadmapView", "The roadmap.")))
# ---- prioritization ----
add("/api/v1/transformations/{transformationId}/prioritization", [TID],
    op("get", "getPrioritization", "prioritization", "Ranked table and value/feasibility comparison under the active weight set, with the labelled 0-100 view, selection and funding state, and sequencing and capacity flags (REQ-S09-001, REQ-S09-004).",
       query=[STATUSQ, UUIDQ("waveId"), '- { name: completeness, in: query, required: false, schema: { type: string, enum: [complete, incomplete] } }',
              '- { name: flag, in: query, required: false, schema: { type: string, pattern: "^[a-z][a-z0-9_.]*$", maxLength: 64 } }'],
       ok=("200", "PrioritizationView", "The prioritization view.")))
add("/api/v1/transformations/{transformationId}/prioritization/weight-sets", [TID],
    op("get", "listWeightSets", "prioritization", "All weight-set versions (v1 = the source defaults 25/25/20/15/15).", ok=("200", "WeightSetList", "All versions, newest first.")),
    op("post", "createWeightSet", "prioritization", "Propose the next weight-set version (prioritization.edit). Weights must total exactly 100% (422 `prioritization.weights_total`, e.g. for 95% or 105%). Immutable once created.",
       body="WeightSetCreate", ok=("201", "WeightSet", "Proposed."), create=True))
VNO = PRM("VersionNo")
add("/api/v1/transformations/{transformationId}/prioritization/weight-sets/{versionNo}", [TID, VNO],
    op("get", "getWeightSet", "prioritization", "Read one weight-set version.", ok=("200", "WeightSet!", "The record.")))
add("/api/v1/transformations/{transformationId}/prioritization/weight-sets/{versionNo}/approve", [TID, VNO],
    op("post", "approveWeightSet", "prioritization", "Activate a proposed weight set (prioritization.approve, business approval; never the proposer). It supersedes the active set and appends new score results; results under the old version keep their reference.",
       body="TransitionNote", ok=("200", "WeightSet", "Active."), ifmatch=True))
add("/api/v1/transformations/{transformationId}/prioritization/weight-sets/{versionNo}/withdraw", [TID, VNO],
    op("post", "withdrawWeightSet", "prioritization", "Withdraw a proposed weight set (prioritization.edit).", body="ReasonRequest",
       ok=("200", "WeightSet", "Withdrawn."), ifmatch=True))
add("/api/v1/initiatives/{initiativeId}/scores", [IID],
    op("get", "getInitiativeScores", "prioritization", "The 1-5 scores of an initiative and its calculated, read-only result under the active weight set; a missing score makes it 'incomplete', never a number.",
       ok=("200", "InitiativeScoreSheet", "Scores and result.")),
    op("post", "createInitiativeScore", "prioritization", "Score one criterion 1-5 (prioritization.score). A score outside 1-5 is 400. The weighted score is never an input.",
       body="InitiativeScoreCreate", ok=("201", "InitiativeScore", "Created; a new result is appended."), create=True, dup=True))
add("/api/v1/initiatives/{initiativeId}/scores/{criterionCode}", [IID, PRM("CriterionCode")],
    op("patch", "updateInitiativeScore", "prioritization", "Change or clear (null) one score (prioritization.score).", body="InitiativeScoreUpdate",
       ok=("200", "InitiativeScore", "Updated; a new result is appended."), ifmatch=True))
add("/api/v1/transformations/{transformationId}/prioritization/rankings", [TID],
    op("get", "listRankingSnapshots", "prioritization", "Proposed ranking snapshots (advisory; never a selection).", query=[CUR, LIM],
       ok=("200", "RankingSnapshotPage", "Page, newest first.")),
    op("post", "createRankingSnapshot", "prioritization", "Propose a ranking under the active weight set (prioritization.edit). Complete submitted initiatives move to ranked; each entry records its rank-change causes.",
       body="TransitionNote", ok=("201", "RankingSnapshotView", "Proposed."), create=True))
add("/api/v1/transformations/{transformationId}/prioritization/rankings/{snapshotNo}", [TID, PRM("SnapshotNo")],
    op("get", "getRankingSnapshot", "prioritization", "Read one snapshot with its entries.", ok=("200", "RankingSnapshotView", "The snapshot.")))
add("/api/v1/transformations/{transformationId}/prioritization/ranking-history", [TID],
    op("get", "getRankingHistory", "prioritization", "Every rank change with its causes and labels, e.g. 'weight version 2', 'score change (feasibility)', 'override: <reason>' (REQ-S09-005).",
       query=[UUIDQ("initiativeId"), CUR, LIM], ok=("200", "RankingHistoryPage", "Page, newest first.")))
add("/api/v1/transformations/{transformationId}/prioritization/overrides", [TID],
    op("get", "listRankingOverrides", "prioritization", "Ranking overrides.", query=[CUR, LIM], ok=("200", "RankingOverridePage", "Page, newest first.")),
    op("post", "createRankingOverride", "prioritization", "Propose an override (prioritization.edit). A reason is required: missing or empty is 400; invisible-only text is 422 `prioritization.override_reason_required`.",
       body="RankingOverrideCreate", ok=("201", "RankingOverride", "Proposed."), create=True, dup=True))
OID = PRM("OverrideId")
add("/api/v1/transformations/{transformationId}/prioritization/overrides/{overrideId}/decision", [TID, OID],
    op("post", "decideRankingOverride", "prioritization", "Approve or reject (prioritization.approve, business approval; the proposer gets 403).",
       body="ApprovalDecision", ok=("200", "RankingOverride", "Decided."), ifmatch=True))
add("/api/v1/transformations/{transformationId}/prioritization/overrides/{overrideId}/revoke", [TID, OID],
    op("post", "revokeRankingOverride", "prioritization", "Revoke an approved override (prioritization.approve).", body="ReasonRequest",
       ok=("200", "RankingOverride", "Revoked."), ifmatch=True))
# ---- T08 dependencies ----
add("/api/v1/dependencies", [],
    op("get", "listT08Dependencies", "dependencies", "T08 Dependency Map on the canonical dependency record (ADR-0023 §4), with schedule flags. The DG2 operations under /transformations/{transformationId}/dependencies are unchanged.",
       query=[TQ, UUIDQ("initiativeId"), ARCH, CUR, LIM], ok=("200", "T08DependencyPage", "Page, newest change first.")),
    op("post", "createT08Dependency", "dependencies", "Create (dependency.edit). From: an initiative or `external`; To: an initiative. An unknown type is 422 `dependency.unknown_type`. A cycle is 422 `dependency.cycle` naming it ('Dependency cycle: INI-01 → INI-02 → INI-01'), race-free (advisory lock and database guard).",
       body="T08DependencyCreate", ok=("201", "T08Dependency", "Created."), create=True, idem=True, dup=True))
DEPID = PRM("DependencyId")
add("/api/v1/dependencies/{dependencyId}", [DEPID],
    op("get", "getT08Dependency", "dependencies", "Read one dependency with its schedule flags.", ok=("200", "T08Dependency!", "The record.")),
    op("patch", "updateT08Dependency", "dependencies", "Update (dependency.edit); the cycle check runs again when an endpoint changes.",
       body="T08DependencyUpdate", ok=("200", "T08Dependency", "Updated."), ifmatch=True))
add("/api/v1/dependencies/{dependencyId}/archive", [DEPID],
    op("post", "archiveT08Dependency", "dependencies", "Archive, never delete, with a reason (dependency.edit).", body="ReasonRequest",
       ok=("200", "T08Dependency", "Archived."), ifmatch=True))
add("/api/v1/dependency-types", [],
    op("get", "listDependencyTypes", "dependencies", "Dependency types: Decision, Tech, Data, Vendor (B0081) and Other are system rows; administrators add types.",
       nf=False, ok=("200", "DependencyTypeList", "All types.")),
    op("post", "createDependencyType", "dependencies", "Add a type (dependency_type.configure).", nf=False, body="DependencyTypeCreate",
       ok=("201", "DependencyType", "Created."), create=True, dup=True))
add("/api/v1/dependency-types/{dependencyTypeCode}", [PRM("DependencyTypeCode")],
    op("patch", "updateDependencyType", "dependencies", "Relabel a type (dependency_type.configure).", body="DependencyTypeUpdate",
       ok=("200", "DependencyType", "Updated."), ifmatch=True),
    op("delete", "retireDependencyType", "dependencies", "Retire a custom type (soft; kept on existing rows). A system type is 422 `dependency_type.system_undeletable` (REQ-PB-052).",
       ok=("200", "DependencyType", "Retired."), ifmatch=True))
# ---- capacity ----
add("/api/v1/transformations/{transformationId}/resource-roles", [TID],
    op("get", "listResourceRoles", "capacity", "Resourcing roles (not access roles).", ok=("200", "ResourceRoleList", "All roles.")),
    op("post", "createResourceRole", "capacity", "Create (capacity.edit).", body="ResourceRoleCreate", ok=("201", "ResourceRole", "Created."),
       create=True, dup=True))
add("/api/v1/transformations/{transformationId}/resource-roles/{resourceRoleId}", [TID, PRM("ResourceRoleId")],
    op("patch", "updateResourceRole", "capacity", "Update labels or archive (capacity.edit).", body="ResourceRoleUpdate",
       ok=("200", "ResourceRole", "Updated."), ifmatch=True))
add("/api/v1/capacity", [],
    op("get", "listCapacity", "capacity", "Capacity rows (available FTE per role and month).", query=[TQ, UUIDQ("resourceRoleId"), CUR, LIM],
       ok=("200", "CapacityPage", "Page.")),
    op("post", "createCapacity", "capacity", "Create (capacity.edit). FTE is a decimal string.", body="CapacityCreate",
       ok=("201", "Capacity", "Created."), create=True, dup=True))
add("/api/v1/capacity/{capacityId}", [PRM("CapacityId")],
    op("get", "getCapacity", "capacity", "Read one capacity row.", ok=("200", "Capacity!", "The record.")),
    op("patch", "updateCapacity", "capacity", "Update or archive (capacity.edit).", body="CapacityUpdate", ok=("200", "Capacity", "Updated."), ifmatch=True))
add("/api/v1/transformations/{transformationId}/capacity-plan", [TID],
    op("get", "getCapacityPlan", "capacity", "Role x month grid: available, demand, committed demand, shortfall and the conflict flag (`capacity.over_allocated`, or `capacity.unknown` without a capacity row) (REQ-PB-059, REQ-S09-004).",
       query=['- { name: from, in: query, required: false, schema: { $ref: "#/components/schemas/BusinessDate" } }',
              '- { name: to, in: query, required: false, schema: { $ref: "#/components/schemas/BusinessDate" } }'],
       ok=("200", "CapacityPlan", "The grid.")))
add("/api/v1/resource-demands", [],
    op("get", "listResourceDemands", "capacity", "Resource demand per initiative, role and month.", query=[TQ, UUIDQ("initiativeId"), CUR, LIM],
       ok=("200", "ResourceDemandPage", "Page.")),
    op("post", "createResourceDemand", "capacity", "Create (capacity.edit).", body="ResourceDemandCreate", ok=("201", "ResourceDemand", "Created (planned)."),
       create=True))
RDID = PRM("ResourceDemandId")
add("/api/v1/resource-demands/{resourceDemandId}", [RDID],
    op("get", "getResourceDemand", "capacity", "Read one demand.", ok=("200", "ResourceDemand!", "The record.")),
    op("patch", "updateResourceDemand", "capacity", "Update a planned demand or archive it (capacity.edit).", body="ResourceDemandUpdate",
       ok=("200", "ResourceDemand", "Updated."), ifmatch=True))
add("/api/v1/resource-demands/{resourceDemandId}/commit", [RDID],
    op("post", "commitResourceDemand", "capacity", "planned -> committed: the capacity commitment G4 needs (capacity.commit; the capacity owner).",
       body="TransitionNote", ok=("200", "ResourceDemand", "Committed."), ifmatch=True))
add("/api/v1/resource-demands/{resourceDemandId}/release", [RDID],
    op("post", "releaseResourceDemand", "capacity", "committed -> released, with a reason (capacity.commit).", body="ReasonRequest",
       ok=("200", "ResourceDemand", "Released."), ifmatch=True))
# ---- funding ----
add("/api/v1/funding-decisions", [],
    op("get", "listFundingDecisions", "portfolio", "Funding decisions (append-only; the latest per initiative decides).", query=[TQ, UUIDQ("initiativeId"), CUR, LIM],
       ok=("200", "FundingDecisionPage", "Page, newest first.")),
    op("post", "createFundingDecision", "portfolio", "Record a person's funding decision for a selected initiative (funding.approve, business approval; FIN or SP). It creates the canonical executive decision (DEC-nn). Approved -> the initiative becomes funded; not selected -> 422 `funding.not_selected`. Nothing auto-approves.",
       body="FundingDecisionCreate", ok=("201", "FundingDecision", "Recorded."), create=True, idem=True))
add("/api/v1/funding-decisions/{fundingDecisionId}", [PRM("FundingDecisionId")],
    op("get", "getFundingDecision", "portfolio", "Read one funding decision.", ok=("200", "FundingDecision", "The record.")))
# ---- business cases (kpi module) ----
add("/api/v1/business-cases", [],
    op("get", "listBusinessCases", "business-cases", "Business cases of one transformation (the transformation case and its initiative cases).",
       query=[TQ, '- { name: level, in: query, required: false, schema: { type: string, enum: [transformation, initiative] } }', ARCH, CUR, LIM],
       ok=("200", "BusinessCasePage", "Page.")),
    op("post", "createBusinessCase", "business-cases", "Create (business_case.edit). One active transformation-level case per transformation; an initiative case links to exactly that case (REQ-PB-054).",
       body="BusinessCaseCreate", ok=("201", "BusinessCase", "Created."), create=True, idem=True, dup=True))
BCID = PRM("BusinessCaseId")
add("/api/v1/business-cases/{businessCaseId}", [BCID],
    op("get", "getBusinessCase", "business-cases", "Read one case with its ten sections and validation state (Stale when the baseline changed after validation).",
       ok=("200", "BusinessCase!", "The record.")),
    op("patch", "updateBusinessCase", "business-cases", "Update sections (business_case.edit).", body="BusinessCaseUpdate",
       ok=("200", "BusinessCase", "Updated."), ifmatch=True))
add("/api/v1/business-cases/{businessCaseId}/archive", [BCID],
    op("post", "archiveBusinessCase", "business-cases", "Archive, never delete (business_case.edit).", body="ReasonRequest",
       ok=("200", "BusinessCase", "Archived."), ifmatch=True))
add("/api/v1/business-cases/{businessCaseId}/totals", [BCID],
    op("get", "getBusinessCaseTotals", "business-cases", "Gross benefits, implementation cost (cash and non-cash) and net value per currency, shown separately; each distinct line is counted once and a transformation case rolls up its initiative cases by reference (REQ-S05-005, REQ-PB-054).",
       ok=("200", "BusinessCaseTotals", "The totals.")))
add("/api/v1/business-cases/{businessCaseId}/baseline-validation", [BCID],
    op("post", "validateBusinessCaseBaseline", "business-cases", "Finance validation of the case baseline (finance.validate; never the case author) (REQ-PB-055).",
       body="FinanceValidationRequest", ok=("200", "BusinessCase", "Validation recorded."), ifmatch=True))
add("/api/v1/business-cases/{businessCaseId}/lines", [BCID],
    op("get", "listBusinessCaseLines", "business-cases", "Investment and benefit lines of a case.", query=[ARCH], ok=("200", "BusinessCaseLineList", "All lines.")),
    op("post", "createBusinessCaseLine", "business-cases", "Create (business_case.edit). Exactly one `class`: two classes are 400; a class that does not fit the kind is 422.",
       body="BusinessCaseLineCreate", ok=("201", "BusinessCaseLine", "Created."), create=True, dup=True))
LID = PRM("LineId")
add("/api/v1/business-cases/{businessCaseId}/lines/{lineId}", [BCID, LID],
    op("patch", "updateBusinessCaseLine", "business-cases", "Update a line (business_case.edit).", body="BusinessCaseLineUpdate",
       ok=("200", "BusinessCaseLine", "Updated."), ifmatch=True))
add("/api/v1/business-cases/{businessCaseId}/lines/{lineId}/archive", [BCID, LID],
    op("post", "archiveBusinessCaseLine", "business-cases", "Archive a line with a reason (business_case.edit).", body="ReasonRequest",
       ok=("200", "BusinessCaseLine", "Archived."), ifmatch=True))
# ---- benefit formulas (kpi module) ----
add("/api/v1/benefit-formula-examples", [],
    op("get", "listBenefitFormulaExamples", "benefit-formulas", "The two B0087 source examples, illustrative with synthetic values (REQ-PB-057).",
       nf=False, ok=("200", "BenefitFormulaExampleList", "Both examples.")))
add("/api/v1/benefit-formulas/validate", [],
    op("post", "checkBenefitFormula", "benefit-formulas", "Parse, type-check and preview an expression with typed variables; writes nothing. Restricted expression language only (ADR-0024 §6): an undefined variable or a period mismatch (monthly ARPU x annual population) is 422 with the reason.",
       nf=False, body="FormulaCheckRequest", ok=("200", "FormulaCheckResult", "Valid: result kind, unit, currency, period and preview value.")))
add("/api/v1/benefit-formulas", [],
    op("get", "listBenefitFormulas", "benefit-formulas", "T09 Benefit Formula register of one transformation.", query=[TQ, ARCH, CUR, LIM],
       ok=("200", "BenefitFormulaPage", "Page.")),
    op("post", "createBenefitFormula", "benefit-formulas", "Create a T09 row with its version 1 (benefit_formula.edit), or instantiate a seeded example (`fromExample`). Confidence outside H/M/L is 400; an invalid expression writes nothing (422).",
       body="BenefitFormulaCreate", ok=("201", "BenefitFormula", "Created."), create=True, idem=True))
BFID = PRM("BenefitFormulaId")
add("/api/v1/benefit-formulas/{benefitFormulaId}", [BFID],
    op("get", "getBenefitFormula", "benefit-formulas", "Read one T09 row with its current version.", ok=("200", "BenefitFormula!", "The record.")),
    op("patch", "updateBenefitFormula", "benefit-formulas", "Update the T09 text columns (benefit_formula.edit); the formula changes only through a new version.",
       body="BenefitFormulaUpdate", ok=("200", "BenefitFormula", "Updated."), ifmatch=True))
add("/api/v1/benefit-formulas/{benefitFormulaId}/archive", [BFID],
    op("post", "archiveBenefitFormula", "benefit-formulas", "Archive with a reason (benefit_formula.edit).", body="ReasonRequest",
       ok=("200", "BenefitFormula", "Archived."), ifmatch=True))
add("/api/v1/benefit-formulas/{benefitFormulaId}/versions", [BFID],
    op("get", "listBenefitFormulaVersions", "benefit-formulas", "All versions with their Finance validation state.",
       ok=("200", "BenefitFormulaVersionList", "All versions, newest first.")),
    op("post", "createBenefitFormulaVersion", "benefit-formulas", "Create the next immutable version and make it current (benefit_formula.edit; If-Match is the formula's version). It starts unvalidated.",
       body="BenefitFormulaVersionCreate", ok=("201", "BenefitFormulaVersion", "Created."), create=True, ifmatch=True))
add("/api/v1/benefit-formulas/{benefitFormulaId}/versions/{versionNo}", [BFID, VNO],
    op("get", "getBenefitFormulaVersion", "benefit-formulas", "Read one version with its typed variables.", ok=("200", "BenefitFormulaVersion!", "The record.")))
add("/api/v1/benefit-formulas/{benefitFormulaId}/versions/{versionNo}/calculations", [BFID, VNO],
    op("get", "listBenefitCalculations", "benefit-formulas", "Calculation lineage of a version.", query=[CUR, LIM],
       ok=("200", "BenefitCalculationPage", "Page, newest first.")),
    op("post", "createBenefitCalculation", "benefit-formulas", "Evaluate the version with inputs, assumptions and a period and record the lineage (benefit_formula.edit). Division by zero gives a null (Unknown) result with `formula.division_by_zero`, never 0.",
       body="BenefitCalculationCreate", ok=("201", "BenefitCalculation", "Recorded."), create=True))
add("/api/v1/benefit-formulas/{benefitFormulaId}/versions/{versionNo}/validation", [BFID, VNO],
    op("post", "validateBenefitFormulaVersion", "benefit-formulas", "Finance validation of the benefit logic (finance.validate; never the author). Final once recorded (REQ-PB-055).",
       body="FinanceValidationRequest", ok=("200", "BenefitFormulaVersion", "Validation recorded."), ifmatch=True))

out = []
for path, d in paths.items():
    out.append(f"  {path}:")
    if d["params"]:
        out.append("    parameters:")
        out += ["      " + p for p in d["params"]]
    for L in d["ops"]:
        out += L
with open(os.path.join(OUT, "p3-paths.yaml"), "w") as f:
    f.write("\n".join(out) + "\n")
with open(os.path.join(OUT, "p3-operations.json"), "w") as f:
    json.dump(OPS, f, indent=1)
print(len(OPS), "operations,", len(paths), "paths")
