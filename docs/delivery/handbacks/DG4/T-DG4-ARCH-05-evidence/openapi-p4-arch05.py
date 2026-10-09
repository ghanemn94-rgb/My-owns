#!/usr/bin/env python3
"""T-DG4-ARCH-05: generates the slice D OpenAPI additions (ADR-0032) and inserts them into
docs/api/openapi.yaml. Provenance only: run once by the solution-architect; the YAML file is the contract.
The op()/render_paths()/render_params()/page() helpers are copied from the T-DG4-ARCH-04 generator.

  python3 docs/delivery/handbacks/DG4/T-DG4-ARCH-05-evidence/openapi-p4-arch05.py docs/api/openapi.yaml

Every operation declares the ADR-0007 §5b statuses: 400, 401 (non-public), 403 (when it needs a permission or a
record-level right), 404 (path ids), 409/428 (If-Match), 422 (business rules) and 429; problem+json errors;
ETag on single-resource responses; Cursor/Limit on paginated lists. Request bodies are application/json.
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
F = T + "/forums/{forumId}"
FP = ["TransformationId", "ForumId"]
S = T + "/meeting-series/{meetingSeriesId}"
SP = ["TransformationId", "MeetingSeriesId"]
M = T + "/meetings/{meetingId}"
MP = ["TransformationId", "MeetingId"]
AI = M + "/agenda-items/{agendaItemId}"
AIP = ["TransformationId", "MeetingId", "AgendaItemId"]
ED = T + "/executive-decisions/{decisionId}"
EDP = ["TransformationId", "DecisionId"]
RD = dict(forbidden=False, rule=False)

# ----------------------------------------------------------------------------------------------- forums (ADR-0032 §1)
op(T + "/forums", "get", "listForums", "forums",
   "The transformation's governance forums: the five operating-system layers of B0093 (verbatim source texts on the template; REQ-PB-060) and any forum the team added, with participants, quorum, cut-off and agenda rules (transformation.read).",
   params=TP, query=["Cursor", "Limit", "ForumStatusQuery"], ok_schema="ForumPage", **RD)
op(T + "/forums", "post", "createForum", "forums",
   "Add a forum (forum.configure; TO). 422 forum.party_unknown, forum.output_kind_invalid, forum.publish_output_not_listed.",
   params=TP, body="ForumCreate", ok="201", ok_desc="Created (active).", ok_schema="Forum", etag=True, location=True)
op(F, "get", "getForum", "forums", "Read one forum with its source layer texts (template forums) and configuration (transformation.read).",
   params=FP, ok_schema="Forum", etag=True, **RD)
op(F, "patch", "updateForum", "forums",
   "Configure a forum: labels, chair party, secretary, participant parties, outputs, publication rule, quorum, cut-off and agenda rules, or archive it (forum.configure; REQ-S10-005). 422 forum.party_unknown, forum.output_kind_invalid, forum.publish_output_not_listed, forum.archived.",
   params=FP, body="ForumUpdate", ok_schema="Forum", etag=True, if_match=True)
op(F + "/participants", "get", "listForumParticipants", "forums", "The forum's named participants (people and governed groups) and whether each counts for quorum (transformation.read).",
   params=FP, query=["Cursor", "Limit"], ok_schema="ForumParticipantPage", **RD)
op(F + "/participants", "post", "addForumParticipant", "forums",
   "Add a person or a governed group as a participant (forum.configure). 409 forum_participant.exists; 422 forum.archived.",
   params=FP, body="ForumParticipantCreate", ok="201", ok_desc="Created.", ok_schema="ForumParticipant", etag=True, location=True, dup=True)
op(F + "/participants/{forumParticipantId}/remove", "post", "removeForumParticipant", "forums",
   "Remove a participant; final, the row stays as history (forum.configure). 422 forum_participant.removed.",
   params=["TransformationId", "ForumId", "ForumParticipantId"], ok_schema="ForumParticipant", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- meeting series (ADR-0032 §2)
op(T + "/meeting-series", "get", "listMeetingSeries", "meeting-series", "The meeting series of the transformation's forums (transformation.read).",
   params=TP, query=["Cursor", "Limit", "ForumIdQuery", "MeetingSeriesStatusQuery"], ok_schema="MeetingSeriesPage", **RD)
op(T + "/meeting-series", "post", "createMeetingSeries", "meeting-series",
   "Start a forum's meeting series on a recurrence rule; the meetings up to the horizon are generated in the same transaction, on the business calendar (forum.configure). 400 meeting_series.rule_invalid; 409 meeting_series.exists.",
   params=TP, body="MeetingSeriesCreate", ok="201", ok_desc="Created (active), with the generated meetings.", ok_schema="MeetingSeriesResult", etag=True, location=True, dup=True)
op(S, "get", "getMeetingSeries", "meeting-series", "Read one meeting series (transformation.read).",
   params=SP, ok_schema="MeetingSeries", etag=True, **RD)
op(S, "patch", "updateMeetingSeries", "meeting-series",
   "Change the recurrence or other series fields. A recurrence change steps ruleVersion and regenerates FUTURE meetings only: future scheduled meetings without content are cancelled and replaced; past meetings and meetings with content are kept and listed (forum.configure; REQ-S10-005). 400 meeting_series.rule_invalid; 422 meeting_series.ended.",
   params=SP, body="MeetingSeriesUpdate", ok_schema="MeetingSeriesResult", etag=True, if_match=True)
op(S + "/end", "post", "endMeetingSeries", "meeting-series",
   "End a series; its future scheduled meetings without content are cancelled; final (forum.configure). 422 meeting_series.ended.",
   params=SP, ok_schema="MeetingSeriesResult", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- meetings (ADR-0032 §3)
op(T + "/meetings", "get", "listMeetings", "meetings", "Meetings of the transformation, by forum, status and date range (transformation.read).",
   params=TP, query=["Cursor", "Limit", "ForumIdQuery", "MeetingStatusQuery", "FromDateQuery", "ToDateQuery"], ok_schema="MeetingPage", **RD)
op(T + "/meetings", "post", "createMeeting", "meetings",
   "Schedule an ad-hoc meeting of a forum; chair from the forum's chair party, quorum and cut-off from the forum (meeting.prepare; TL, TO, SEC). 422 forum.archived.",
   params=TP, body="MeetingCreate", ok="201", ok_desc="Created (scheduled).", ok_schema="Meeting", etag=True, location=True)
op(M, "get", "getMeeting", "meetings", "Read one meeting: the same record the presentation mode and printable pack use (M0212), with its present count and quorum state (transformation.read).",
   params=MP, ok_schema="Meeting", etag=True, **RD)
op(M, "patch", "updateMeeting", "meetings",
   "Reschedule a meeting or change its location, chair, secretary or quorum (quorum until the session starts) (meeting.prepare). 422 meeting.final.",
   params=MP, body="MeetingUpdate", ok_schema="Meeting", etag=True, if_match=True)
op(M + "/publish-agenda", "post", "publishMeetingAgenda", "meetings",
   "Publish the agenda: scheduled -> agenda_published (meeting.chair; the meeting's chair only). 422 meeting.agenda_empty, meeting.agenda_has_drafts, meeting.status_transition, meeting.chair_unassigned; 403 meeting.not_chair.",
   params=MP, ok_schema="Meeting", etag=True, if_match=True)
op(M + "/start", "post", "startMeeting", "meetings", "Open the session: scheduled or agenda_published -> in_session (meeting.prepare). 422 meeting.status_transition.",
   params=MP, ok_schema="Meeting", etag=True, if_match=True)
op(M + "/close", "post", "closeMeeting", "meetings", "Close the session: in_session -> held (meeting.prepare). 422 meeting.status_transition.",
   params=MP, ok_schema="Meeting", etag=True, if_match=True)
op(M + "/cancel", "post", "cancelMeeting", "meetings", "Cancel a scheduled meeting with a note; final (meeting.prepare). 422 meeting.status_transition.",
   params=MP, body="ReasonRequest", ok_schema="Meeting", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- agenda items (ADR-0032 §3.2)
op(M + "/agenda-items", "get", "listAgendaItems", "agenda-items", "The meeting's agenda in order; an executive ask shows its T16 elements from the linked decision (transformation.read).",
   params=MP, query=["Cursor", "Limit"], ok_schema="AgendaItemPage", **RD)
op(M + "/agenda-items", "post", "createAgendaItem", "agenda-items",
   "Add a draft agenda item: an executive ask (linking an open T16 ask, or with a draft brief), a discussion or an information item (meeting.prepare). 422 agenda_item.executive_asks_only (Escalate decisions, not status), agenda_item.after_cutoff, agenda_item.max_items, agenda_item.decision_not_linkable, meeting.frozen.",
   params=MP, body="AgendaItemCreate", ok="201", ok_desc="Created (draft).", ok_schema="AgendaItem", etag=True, location=True)
op(AI, "patch", "updateAgendaItem", "agenda-items", "Edit a draft agenda item or its brief (meeting.prepare). 422 agenda_item.not_draft, agenda_item.final.",
   params=AIP, body="AgendaItemUpdate", ok_schema="AgendaItem", etag=True, if_match=True)
op(AI + "/publish", "post", "publishAgendaItem", "agenda-items",
   "Publish an agenda item (meeting.chair; the meeting's chair). An executive ask must state the decision required, why now, options, recommendation, impact of delay, decision owner and required date (REQ-PB-068, REQ-S10-012); publishing a brief creates its T16 executive decision. 422 agenda_item.executive_ask_incomplete, agenda_item.not_draft; 403 meeting.not_chair.",
   params=AIP, ok_schema="AgendaItem", etag=True, if_match=True)
op(AI + "/withdraw", "post", "withdrawAgendaItem", "agenda-items", "Withdraw a draft or published item; final (meeting.prepare). 422 agenda_item.final.",
   params=AIP, ok_schema="AgendaItem", etag=True, if_match=True)
op(AI + "/outcome", "post", "recordAgendaItemOutcome", "agenda-items",
   "Record the item's outcome. 'decided' records the linked T16 decision's Outcome (executive_decision.decide; the decision owner or an active delegate) and needs the configured quorum (REQ-S10-011); 'deferred' and 'noted' need meeting.prepare. 422 meeting.quorum_not_met, meeting.not_in_session, agenda_item.final; 403 executive_decision.not_owner.",
   params=AIP, body="AgendaItemOutcome", ok_schema="AgendaItem", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- attendance (ADR-0032 §3.3)
op(M + "/attendance", "get", "listMeetingAttendance", "attendance", "Attendance of the meeting, with the present count and the quorum state (transformation.read).",
   params=MP, query=["Cursor", "Limit"], ok_schema="MeetingAttendancePage", **RD)
op(M + "/attendance", "post", "recordMeetingAttendance", "attendance",
   "Record one person's attendance (meeting.prepare). 409 meeting_attendance.exists; 422 meeting.frozen.",
   params=MP, body="MeetingAttendanceCreate", ok="201", ok_desc="Created.", ok_schema="MeetingAttendance", etag=True, location=True, dup=True)
op(M + "/attendance/{meetingAttendanceId}", "patch", "updateMeetingAttendance", "attendance",
   "Correct one person's attendance (meeting.prepare). 422 meeting.frozen.",
   params=["TransformationId", "MeetingId", "MeetingAttendanceId"], body="MeetingAttendanceUpdate", ok_schema="MeetingAttendance", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- minutes (ADR-0032 §5)
op(M + "/minutes", "get", "getMeetingMinutes", "minutes", "The meeting's minutes; 404 when none are drafted (transformation.read).",
   params=MP, ok_schema="MeetingMinutes", etag=True, **RD)
op(M + "/minutes", "post", "createMeetingMinutes", "minutes", "Draft the minutes (meeting.prepare). 409 meeting_minutes.exists; 422 meeting.frozen.",
   params=MP, body="MeetingMinutesCreate", ok="201", ok_desc="Created (draft).", ok_schema="MeetingMinutes", etag=True, location=True, dup=True)
op(M + "/minutes", "patch", "updateMeetingMinutes", "minutes",
   "Edit draft minutes, or return approved minutes to draft (meeting.prepare to edit; meeting.chair to return). 422 meeting_minutes.published, meeting_minutes.approved_frozen.",
   params=MP, body="MeetingMinutesUpdate", ok_schema="MeetingMinutes", etag=True, if_match=True)
op(M + "/minutes/approve", "post", "approveMeetingMinutes", "minutes",
   "Approve the minutes: draft -> approved (meeting.chair; the meeting's chair). 422 meeting_minutes.status_transition; 403 meeting.not_chair.",
   params=MP, ok_schema="MeetingMinutes", etag=True, if_match=True)
op(M + "/minutes/publish", "post", "publishMeetingMinutes", "minutes",
   "Publish approved minutes for a held meeting; they become immutable and the meeting moves to minutes_published (meeting.chair). A forum's required outputs must be present: a Value Review needs a benefit evidence or forecast entry (REQ-PB-061). 422 meeting_minutes.required_output_missing, meeting_minutes.meeting_not_held, meeting_minutes.status_transition; 403 meeting.not_chair.",
   params=MP, ok_schema="MeetingMinutes", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- outputs and actions (ADR-0032 §4, §5.4)
op(M + "/outputs", "get", "listMeetingOutputs", "meetings", "The meeting's outputs, each linked to its canonical record (transformation.read).",
   params=MP, query=["Cursor", "Limit"], ok_schema="MeetingOutputPage", **RD)
op(M + "/outputs", "post", "createMeetingOutput", "meetings",
   "Record an output defined for the forum's layer, linked to a canonical record of the transformation; append-only (meeting.prepare). 422 meeting_output.kind_not_in_forum, meeting_output.record_required, meeting_output.record_not_found, meeting.frozen.",
   params=MP, body="MeetingOutputCreate", ok="201", ok_desc="Created.", ok_schema="MeetingOutput", location=True)
op(M + "/actions", "get", "listMeetingActions", "meetings", "Actions assigned in the meeting with their current status and overdue flag (monitor closure; transformation.read).",
   params=MP, query=["Cursor", "Limit"], ok_schema="MeetingActionPage", **RD)
op(M + "/actions", "post", "createMeetingAction", "meetings",
   "Assign an owned action in the meeting: creates the canonical action and its meeting link, and the owner's My Work item (meeting.prepare). 422 meeting.frozen.",
   params=MP, body="MeetingActionCreate", ok="201", ok_desc="Created.", ok_schema="MeetingAction", location=True)
op(M + "/blocker-statuses", "get", "listBlockerStatuses", "escalations", "Blocker RAGs recorded in this meeting (one review cycle; transformation.read).",
   params=MP, query=["Cursor", "Limit"], ok_schema="BlockerStatusPage", **RD)
op(M + "/blocker-statuses", "post", "recordBlockerStatus", "escalations",
   "Record a blocker's RAG for this cycle; append-only. A blocker red for the configured number of consecutive cycles gets one open T16 ask (REQ-PB-082) (meeting.prepare). 409 blocker_status.exists; 422 meeting.not_in_session, blocker_status.record_not_found.",
   params=MP, body="BlockerStatusCreate", ok="201", ok_desc="Created.", ok_schema="BlockerStatus", location=True, dup=True)

# ----------------------------------------------------------------------------------------------- T16 (ADR-0032 §6)
op(T + "/executive-decisions", "get", "listExecutiveDecisions", "executive-decisions",
   "The T16 Executive Decision Log (REQ-PB-081): the nine T16 columns on the canonical decision records of kind executive; overdue=true lists open or deferred asks past their decision date (Asia/Riyadh business day) (transformation.read).",
   params=TP, query=["Cursor", "Limit", "ExecutiveDecisionStatusQuery", "OverdueQuery", "AskOriginQuery"], ok_schema="ExecutiveDecisionPage", **RD)
op(T + "/executive-decisions", "post", "createExecutiveDecision", "executive-decisions",
   "Raise an executive ask with decision, why now, options, recommendation, impact of delay, decision owner and required date (executive_decision.create; TL, TO, SEC; REQ-S10-012). 400 executive_decision.field_required (e.g. at /whyNow), executive_decision.options_too_few; 409 executive_decision.blocker_ask_open; 422 executive_decision.owner_not_executive, executive_decision.required_date_past.",
   params=TP, body="ExecutiveDecisionCreate", ok="201", ok_desc="Created (open).", ok_schema="ExecutiveDecision", etag=True, location=True, dup=True)
op(ED, "get", "getExecutiveDecision", "executive-decisions", "Read one T16 entry with its options, SLA, escalations and any missing elements (transformation.read).",
   params=EDP, ok_schema="ExecutiveDecision", etag=True, **RD)
op(ED, "patch", "updateExecutiveDecision", "executive-decisions",
   "Complete or edit an open ask (executive_decision.create). 422 executive_decision.closed, executive_decision.owner_not_executive, executive_decision.option_unknown.",
   params=EDP, body="ExecutiveDecisionUpdate", ok_schema="ExecutiveDecision", etag=True, if_match=True)
op(ED + "/outcome", "post", "recordExecutiveDecisionOutcome", "executive-decisions",
   "Record the Outcome: decided (closes the ask; it leaves the overdue list), deferred (new date) or cancelled (executive_decision.decide; SP, BO, FIN; the decision owner or an active delegate). A business decision by a person; never automatic. 403 executive_decision.not_owner; 422 executive_decision.closed, executive_decision.option_unknown, executive_decision.defer_date_required.",
   params=EDP, body="ExecutiveDecisionOutcome", ok_schema="ExecutiveDecision", etag=True, if_match=True)

# ----------------------------------------------------------------------------------------------- escalations (ADR-0032 §7, §8)
op(T + "/escalations", "get", "listDecisionEscalations", "escalations",
   "Decision-SLA escalations of the transformation's executive asks, each with its target or routing error and the delay impact (REQ-S12-011; transformation.read).",
   params=TP, query=["Cursor", "Limit", "DecisionIdQuery"], ok_schema="DecisionEscalationPage", **RD)
op(T + "/escalation-rules", "get", "listEscalationRules", "escalations",
   "The decision-SLA and blocker-red rules in force; isDefault marks a kind without a stored rule (transformation.read).",
   params=TP, query=["Cursor", "Limit"], ok_schema="EscalationRulePage", **RD)
op(T + "/escalation-rules", "post", "createEscalationRule", "escalations",
   "Store the rule of one kind (escalation_rule.configure; TL, TO). 409 escalation_rule.exists; 422 escalation_rule.shape, forum.party_unknown.",
   params=TP, body="EscalationRuleCreate", ok="201", ok_desc="Created.", ok_schema="EscalationRule", etag=True, location=True, dup=True)
op(T + "/escalation-rules/{ruleKind}", "patch", "updateEscalationRule", "escalations",
   "Change the stored rule of one kind (escalation_rule.configure); 404 when the kind has no stored rule. 422 escalation_rule.shape, forum.party_unknown.",
   params=["TransformationId", "EscalationRuleKindPath"], body="EscalationRuleUpdate", ok_schema="EscalationRule", etag=True, if_match=True)

UUID = '{ $ref: "#/components/schemas/Uuid" }'
DATE = '{ $ref: "#/components/schemas/BusinessDate" }'
PARAMS = {
    "ForumId": ("forumId", "path", UUID),
    "ForumParticipantId": ("forumParticipantId", "path", UUID),
    "MeetingSeriesId": ("meetingSeriesId", "path", UUID),
    "MeetingId": ("meetingId", "path", UUID),
    "AgendaItemId": ("agendaItemId", "path", UUID),
    "MeetingAttendanceId": ("meetingAttendanceId", "path", UUID),
    "EscalationRuleKindPath": ("ruleKind", "path", "{ type: string, enum: [decision_sla, blocker_red] }"),
    "ForumStatusQuery": ("status", "query", "{ type: string, enum: [active, archived] }"),
    "ForumIdQuery": ("forumId", "query", UUID),
    "MeetingSeriesStatusQuery": ("status", "query", "{ type: string, enum: [active, ended] }"),
    "MeetingStatusQuery": ("status", "query", '{ $ref: "#/components/schemas/MeetingStatus" }'),
    "FromDateQuery": ("from", "query", DATE),
    "ToDateQuery": ("to", "query", DATE),
    "ExecutiveDecisionStatusQuery": ("status", "query", "{ type: string, enum: [open, decided, deferred, cancelled] }"),
    "AskOriginQuery": ("origin", "query", "{ type: string, enum: [api, agenda, blocker_escalation, earlier_record] }"),
    "DecisionIdQuery": ("decisionId", "query", UUID),
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

U = '{ $ref: "#/components/schemas/Uuid" }'
NU = '{ $ref: "#/components/schemas/NullableUuid" }'
TS = '{ $ref: "#/components/schemas/Timestamp" }'
NTS = '{ oneOf: [{ $ref: "#/components/schemas/Timestamp" }, { type: "null" }] }'
BD = '{ $ref: "#/components/schemas/BusinessDate" }'
NBD = '{ $ref: "#/components/schemas/NullableBusinessDate" }'
V = '{ $ref: "#/components/schemas/Version" }'
PARTY = '{ $ref: "#/components/schemas/PartyCode" }'
OUTKIND = '{ $ref: "#/components/schemas/MeetingOutputKind" }'

SCHEMAS = f'''
    # ---- P4 slice D (T-DG4-ARCH-05; ADR-0032) --------------------------------------------------------------------
    MeetingOutputKind:
      type: string
      enum: [decision, unblocker, benefit_view, integrated_status, decision_log, milestone, action, raid, test, evidence, recommendation, benefit_evidence, forecast, corrective_action]
      description: "The outputs of the five operating-system layers (B0093 'Outputs'), one code per named output."
    MeetingStatus:
      type: string
      enum: [scheduled, agenda_published, in_session, held, minutes_published, cancelled]
    ForumSourceTexts:
      type: object
      description: "The B0093 row of a template forum, verbatim (English) and provisional Arabic (arProvisional)."
      required: [layerEn, cadenceEn, purposeEn, participantsEn, outputsEn, layerAr, cadenceAr, purposeAr, participantsAr, outputsAr, arProvisional, sourceRef]
      additionalProperties: false
      properties:
        layerEn: {{ type: string }}
        cadenceEn: {{ type: string }}
        purposeEn: {{ type: string }}
        participantsEn: {{ type: string }}
        outputsEn: {{ type: string }}
        layerAr: {{ type: string }}
        cadenceAr: {{ type: string }}
        purposeAr: {{ type: string }}
        participantsAr: {{ type: string }}
        outputsAr: {{ type: string }}
        arProvisional: {{ type: boolean }}
        sourceRef: {{ type: string }}
    Forum:
      type: object
      description: "A governance forum of a transformation (REQ-PB-060, REQ-S10-005, REQ-S16-019 Forum)."
      required: [id, transformationId, templateKey, source, ordinal, nameEn, nameAr, cadenceLabel, purpose, participantsLabel, outputsLabel, chairPartyCode, secretaryUserId, participantParties, outputKinds, publishRequiresAnyOutput, executiveAsksOnly, quorumMin, cutoffWorkingDays, agendaMaxItems, lateItemsRule, status, activeSeriesId, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: {U}
        transformationId: {U}
        templateKey: {{ type: [string, "null"], enum: [executive_steerco, transformation_review, workstream_review, rapid_response, value_review, null] }}
        source: {{ oneOf: [{{ $ref: "#/components/schemas/ForumSourceTexts" }}, {{ type: "null" }}] }}
        ordinal: {{ type: integer, minimum: 1, maximum: 999 }}
        nameEn: {{ type: string, minLength: 1, maxLength: 200 }}
        nameAr: {{ type: string, minLength: 1, maxLength: 200 }}
        cadenceLabel: {{ type: string, minLength: 1, maxLength: 200 }}
        purpose: {{ type: string, minLength: 1, maxLength: 2000 }}
        participantsLabel: {{ type: string, minLength: 1, maxLength: 500 }}
        outputsLabel: {{ type: string, minLength: 1, maxLength: 500 }}
        chairPartyCode: {{ oneOf: [{PARTY}, {{ type: "null" }}] }}
        secretaryUserId: {NU}
        participantParties: {{ type: array, maxItems: 18, items: {PARTY} }}
        outputKinds: {{ type: array, minItems: 1, maxItems: 14, items: {OUTKIND} }}
        publishRequiresAnyOutput: {{ type: array, maxItems: 14, items: {OUTKIND}, description: "Minutes are published only when at least one output of one of these kinds exists (Value Review: benefit_evidence, forecast)." }}
        executiveAsksOnly: {{ type: boolean, description: "Escalate decisions, not status (B0102): the agenda takes executive asks only." }}
        quorumMin: {{ type: [integer, "null"], minimum: 1, maximum: 100, description: "null = quorum not configured (no check), never 'met'." }}
        cutoffWorkingDays: {{ type: integer, minimum: 0, maximum: 20 }}
        agendaMaxItems: {{ type: [integer, "null"], minimum: 1, maximum: 50 }}
        lateItemsRule: {{ type: string, enum: [flag, refuse] }}
        status: {{ type: string, enum: [active, archived] }}
        activeSeriesId: {NU}
        version: {V}
        createdAt: {TS}
        createdBy: {U}
        updatedAt: {TS}
        updatedBy: {U}
    ForumCreate:
      type: object
      required: [nameEn, nameAr, cadenceLabel, purpose, participantsLabel, outputsLabel, outputKinds]
      additionalProperties: false
      properties:
        nameEn: {{ type: string, minLength: 1, maxLength: 200 }}
        nameAr: {{ type: string, minLength: 1, maxLength: 200 }}
        cadenceLabel: {{ type: string, minLength: 1, maxLength: 200 }}
        purpose: {{ type: string, minLength: 1, maxLength: 2000 }}
        participantsLabel: {{ type: string, minLength: 1, maxLength: 500 }}
        outputsLabel: {{ type: string, minLength: 1, maxLength: 500 }}
        chairPartyCode: {{ oneOf: [{PARTY}, {{ type: "null" }}] }}
        secretaryUserId: {NU}
        participantParties: {{ type: array, maxItems: 18, items: {PARTY} }}
        outputKinds: {{ type: array, minItems: 1, maxItems: 14, items: {OUTKIND} }}
        publishRequiresAnyOutput: {{ type: array, maxItems: 14, items: {OUTKIND} }}
        executiveAsksOnly: {{ type: boolean }}
        quorumMin: {{ type: [integer, "null"], minimum: 1, maximum: 100 }}
        cutoffWorkingDays: {{ type: integer, minimum: 0, maximum: 20 }}
        agendaMaxItems: {{ type: [integer, "null"], minimum: 1, maximum: 50 }}
        lateItemsRule: {{ type: string, enum: [flag, refuse] }}
    ForumUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        nameEn: {{ type: string, minLength: 1, maxLength: 200 }}
        nameAr: {{ type: string, minLength: 1, maxLength: 200 }}
        cadenceLabel: {{ type: string, minLength: 1, maxLength: 200 }}
        purpose: {{ type: string, minLength: 1, maxLength: 2000 }}
        participantsLabel: {{ type: string, minLength: 1, maxLength: 500 }}
        outputsLabel: {{ type: string, minLength: 1, maxLength: 500 }}
        chairPartyCode: {{ oneOf: [{PARTY}, {{ type: "null" }}] }}
        secretaryUserId: {NU}
        participantParties: {{ type: array, maxItems: 18, items: {PARTY} }}
        outputKinds: {{ type: array, minItems: 1, maxItems: 14, items: {OUTKIND} }}
        publishRequiresAnyOutput: {{ type: array, maxItems: 14, items: {OUTKIND} }}
        executiveAsksOnly: {{ type: boolean }}
        quorumMin: {{ type: [integer, "null"], minimum: 1, maximum: 100 }}
        cutoffWorkingDays: {{ type: integer, minimum: 0, maximum: 20 }}
        agendaMaxItems: {{ type: [integer, "null"], minimum: 1, maximum: 50 }}
        lateItemsRule: {{ type: string, enum: [flag, refuse] }}
        status: {{ type: string, enum: [archived], description: "Archiving is final." }}
    ForumParticipant:
      type: object
      required: [id, forumId, userId, groupId, countsForQuorum, status, removedAt, removedBy, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: {U}
        forumId: {U}
        userId: {NU}
        groupId: {NU}
        countsForQuorum: {{ type: boolean }}
        status: {{ type: string, enum: [active, removed] }}
        removedAt: {NTS}
        removedBy: {NU}
        version: {V}
        createdAt: {TS}
        createdBy: {U}
        updatedAt: {TS}
        updatedBy: {U}
    ForumParticipantCreate:
      type: object
      additionalProperties: false
      description: "Exactly one of userId and groupId."
      oneOf:
        - required: [userId]
        - required: [groupId]
      properties:
        userId: {U}
        groupId: {U}
        countsForQuorum: {{ type: boolean }}
    MeetingSeries:
      type: object
      description: "The recurrence of a forum's meetings (REQ-S10-005). ruleVersion steps by 1 on every recurrence change."
      required: [id, transformationId, forumId, frequency, intervalCount, weekdays, monthDay, startDate, endDate, startTime, durationMinutes, timezone, nonWorkingDayRule, horizonDays, location, ruleVersion, generatedThrough, status, endedAt, endedBy, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: {U}
        transformationId: {U}
        forumId: {U}
        frequency: {{ type: string, enum: [daily, weekly, monthly] }}
        intervalCount: {{ type: integer, minimum: 1, maximum: 12 }}
        weekdays: {{ type: [array, "null"], minItems: 1, maxItems: 7, uniqueItems: true, items: {{ $ref: "#/components/schemas/Weekday" }} }}
        monthDay: {{ type: [integer, "null"], minimum: 1, maximum: 28 }}
        startDate: {BD}
        endDate: {NBD}
        startTime: {{ type: string, pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }}
        durationMinutes: {{ type: integer, minimum: 15, maximum: 480 }}
        timezone: {{ type: string, minLength: 1, maxLength: 64 }}
        nonWorkingDayRule: {{ type: string, enum: [next_working_day, skip, keep] }}
        horizonDays: {{ type: integer, minimum: 7, maximum: 366 }}
        location: {{ type: [string, "null"], minLength: 1, maxLength: 300 }}
        ruleVersion: {{ type: integer, minimum: 1 }}
        generatedThrough: {NBD}
        status: {{ type: string, enum: [active, ended] }}
        endedAt: {NTS}
        endedBy: {NU}
        version: {V}
        createdAt: {TS}
        createdBy: {U}
        updatedAt: {TS}
        updatedBy: {NU}
    MeetingSeriesCreate:
      type: object
      required: [forumId, frequency, intervalCount, startDate, startTime, durationMinutes]
      additionalProperties: false
      properties:
        forumId: {U}
        frequency: {{ type: string, enum: [daily, weekly, monthly] }}
        intervalCount: {{ type: integer, minimum: 1, maximum: 12 }}
        weekdays: {{ type: [array, "null"], minItems: 1, maxItems: 7, uniqueItems: true, items: {{ $ref: "#/components/schemas/Weekday" }} }}
        monthDay: {{ type: [integer, "null"], minimum: 1, maximum: 28 }}
        startDate: {BD}
        endDate: {NBD}
        startTime: {{ type: string, pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }}
        durationMinutes: {{ type: integer, minimum: 15, maximum: 480 }}
        timezone: {{ type: string, minLength: 1, maxLength: 64, description: "Default: the organization's calendar timezone (Asia/Riyadh)." }}
        nonWorkingDayRule: {{ type: string, enum: [next_working_day, skip, keep] }}
        horizonDays: {{ type: integer, minimum: 7, maximum: 366 }}
        location: {{ type: [string, "null"], minLength: 1, maxLength: 300 }}
    MeetingSeriesUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        frequency: {{ type: string, enum: [daily, weekly, monthly] }}
        intervalCount: {{ type: integer, minimum: 1, maximum: 12 }}
        weekdays: {{ type: [array, "null"], minItems: 1, maxItems: 7, uniqueItems: true, items: {{ $ref: "#/components/schemas/Weekday" }} }}
        monthDay: {{ type: [integer, "null"], minimum: 1, maximum: 28 }}
        startDate: {BD}
        endDate: {NBD}
        startTime: {{ type: string, pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }}
        durationMinutes: {{ type: integer, minimum: 15, maximum: 480 }}
        timezone: {{ type: string, minLength: 1, maxLength: 64 }}
        nonWorkingDayRule: {{ type: string, enum: [next_working_day, skip, keep] }}
        horizonDays: {{ type: integer, minimum: 7, maximum: 366 }}
        location: {{ type: [string, "null"], minLength: 1, maxLength: 300 }}
    MeetingSeriesResult:
      type: object
      description: "The series after the change, and the meetings the change created, cancelled (future, scheduled, without content) and kept (past, started or with content)."
      required: [series, createdMeetingIds, cancelledMeetingIds, keptMeetingIds, generationUnknownReason]
      additionalProperties: false
      properties:
        series: {{ $ref: "#/components/schemas/MeetingSeries" }}
        createdMeetingIds: {{ type: array, maxItems: 400, items: {U} }}
        cancelledMeetingIds: {{ type: array, maxItems: 400, items: {U} }}
        keptMeetingIds: {{ type: array, maxItems: 400, items: {U} }}
        generationUnknownReason: {{ type: [string, "null"], enum: [calendar_not_configured, null], description: "No meeting could be generated because the working-day calendar is not configured." }}
    Meeting:
      type: object
      description: "One forum meeting (REQ-S16-019 Meeting). The presentation mode and the printable pack read this same record (M0212)."
      required: [id, transformationId, forumId, seriesId, seriesRuleVersion, occurrenceDate, scheduledDate, startsAt, endsAt, timezone, location, chairUserId, secretaryUserId, quorumMin, presentCount, quorumState, cutoffDate, cutoffUnknownReason, status, cancelReason, cancelNote, cancelledAt, cancelledBy, startedAt, heldAt, createdSource, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: {U}
        transformationId: {U}
        forumId: {U}
        seriesId: {NU}
        seriesRuleVersion: {{ type: [integer, "null"], minimum: 1 }}
        occurrenceDate: {NBD}
        scheduledDate: {BD}
        startsAt: {TS}
        endsAt: {TS}
        timezone: {{ type: string }}
        location: {{ type: [string, "null"], minLength: 1, maxLength: 300 }}
        chairUserId: {NU}
        secretaryUserId: {NU}
        quorumMin: {{ type: [integer, "null"], minimum: 1, maximum: 100 }}
        presentCount: {{ type: integer, minimum: 0, description: "Attendance rows present and counting for quorum." }}
        quorumState: {{ type: string, enum: [not_configured, met, not_met] }}
        cutoffDate: {NBD}
        cutoffUnknownReason: {{ type: [string, "null"], enum: [calendar_not_configured, null] }}
        status: {{ $ref: "#/components/schemas/MeetingStatus" }}
        cancelReason: {{ type: [string, "null"], enum: [series_regenerated, series_ended, manual, null] }}
        cancelNote: {{ type: [string, "null"], minLength: 3, maxLength: 2000 }}
        cancelledAt: {NTS}
        cancelledBy: {NU}
        startedAt: {NTS}
        heldAt: {NTS}
        createdSource: {{ type: string, enum: [api, worker] }}
        version: {V}
        createdAt: {TS}
        createdBy: {NU}
        updatedAt: {TS}
        updatedBy: {NU}
    MeetingCreate:
      type: object
      required: [forumId, scheduledDate, startTime, durationMinutes]
      additionalProperties: false
      properties:
        forumId: {U}
        scheduledDate: {BD}
        startTime: {{ type: string, pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }}
        durationMinutes: {{ type: integer, minimum: 15, maximum: 480 }}
        location: {{ type: [string, "null"], minLength: 1, maxLength: 300 }}
        chairUserId: {NU}
        secretaryUserId: {NU}
    MeetingUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        scheduledDate: {BD}
        startTime: {{ type: string, pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }}
        durationMinutes: {{ type: integer, minimum: 15, maximum: 480 }}
        location: {{ type: [string, "null"], minLength: 1, maxLength: 300 }}
        chairUserId: {NU}
        secretaryUserId: {NU}
        quorumMin: {{ type: [integer, "null"], minimum: 1, maximum: 100 }}
    ExecutiveAskBrief:
      type: object
      description: "A draft executive ask on an agenda item; publication moves it into a T16 decision and clears it."
      required: [decisionRequired, whyNow, options, recommendation, impactOfDelay, ownerUserId, requiredDate]
      additionalProperties: false
      properties:
        decisionRequired: {{ type: [string, "null"], minLength: 1, maxLength: 500 }}
        whyNow: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        options: {{ type: [array, "null"], minItems: 1, maxItems: 26, items: {{ type: string, minLength: 1, maxLength: 300 }} }}
        recommendation: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        impactOfDelay: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        ownerUserId: {NU}
        requiredDate: {NBD}
    ExecutiveAskBriefInput:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        decisionRequired: {{ type: [string, "null"], minLength: 1, maxLength: 500 }}
        whyNow: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        options: {{ type: [array, "null"], minItems: 1, maxItems: 26, items: {{ type: string, minLength: 1, maxLength: 300 }} }}
        recommendation: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        impactOfDelay: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        ownerUserId: {NU}
        requiredDate: {NBD}
    AgendaItem:
      type: object
      description: "One agenda item (REQ-S16-019 AgendaItem). An executive ask links its T16 decision (decisionId) or, while a draft, carries a brief."
      required: [id, meetingId, ordinal, itemKind, title, description, presenterUserId, durationMinutes, materialsEvidenceIds, decisionId, brief, missingElements, late, status, publishedAt, publishedBy, outcome, outcomeQuorumPresent, outcomeRecordedAt, outcomeRecordedBy, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: {U}
        meetingId: {U}
        ordinal: {{ type: integer, minimum: 1, maximum: 999 }}
        itemKind: {{ type: string, enum: [executive_ask, discussion, information] }}
        title: {{ type: string, minLength: 1, maxLength: 500 }}
        description: {{ type: [string, "null"], minLength: 1, maxLength: 8000 }}
        presenterUserId: {NU}
        durationMinutes: {{ type: [integer, "null"], minimum: 1, maximum: 480 }}
        materialsEvidenceIds: {{ type: array, maxItems: 20, items: {U} }}
        decisionId: {NU}
        brief: {{ oneOf: [{{ $ref: "#/components/schemas/ExecutiveAskBrief" }}, {{ type: "null" }}] }}
        missingElements: {{ type: array, maxItems: 7, items: {{ type: string, enum: [decision_required, why_now, options, recommendation, impact_of_delay, decision_owner, required_date] }}, description: "For an executive ask: the elements it does not state yet (empty when complete)." }}
        late: {{ type: boolean }}
        status: {{ type: string, enum: [draft, published, closed, withdrawn] }}
        publishedAt: {NTS}
        publishedBy: {NU}
        outcome: {{ type: [string, "null"], enum: [decided, deferred, noted, null] }}
        outcomeQuorumPresent: {{ type: [integer, "null"], minimum: 0 }}
        outcomeRecordedAt: {NTS}
        outcomeRecordedBy: {NU}
        version: {V}
        createdAt: {TS}
        createdBy: {U}
        updatedAt: {TS}
        updatedBy: {U}
    AgendaItemCreate:
      type: object
      required: [itemKind, title]
      additionalProperties: false
      properties:
        itemKind: {{ type: string, enum: [executive_ask, discussion, information] }}
        title: {{ type: string, minLength: 1, maxLength: 500 }}
        description: {{ type: [string, "null"], minLength: 1, maxLength: 8000 }}
        presenterUserId: {NU}
        durationMinutes: {{ type: [integer, "null"], minimum: 1, maximum: 480 }}
        materialsEvidenceIds: {{ type: array, maxItems: 20, items: {U} }}
        decisionId: {{ $ref: "#/components/schemas/Uuid", description: "An open executive ask of this transformation (executive_ask only; not with a brief)." }}
        brief: {{ $ref: "#/components/schemas/ExecutiveAskBriefInput" }}
    AgendaItemUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        title: {{ type: string, minLength: 1, maxLength: 500 }}
        description: {{ type: [string, "null"], minLength: 1, maxLength: 8000 }}
        presenterUserId: {NU}
        durationMinutes: {{ type: [integer, "null"], minimum: 1, maximum: 480 }}
        materialsEvidenceIds: {{ type: array, maxItems: 20, items: {U} }}
        ordinal: {{ type: integer, minimum: 1, maximum: 999 }}
        decisionId: {NU}
        brief: {{ oneOf: [{{ $ref: "#/components/schemas/ExecutiveAskBriefInput" }}, {{ type: "null" }}] }}
    AgendaItemOutcome:
      type: object
      required: [outcome]
      additionalProperties: false
      properties:
        outcome: {{ type: string, enum: [decided, deferred, noted] }}
        chosenOptionLabel: {{ type: string, pattern: "^[A-Z]$" }}
        outcomeText: {{ type: string, minLength: 1, maxLength: 8000, description: "Required for decided (the T16 Outcome)." }}
        decisionVersion: {{ type: integer, minimum: 1, description: "Required for decided: the T16 decision version the outcome applies to (stale -> 409)." }}
    MeetingAttendance:
      type: object
      description: "One person's attendance at one meeting (REQ-S16-019 Attendance)."
      required: [id, meetingId, userId, attendance, countsForQuorum, onBehalfOfUserId, note, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: {U}
        meetingId: {U}
        userId: {U}
        attendance: {{ type: string, enum: [present, absent, apologies] }}
        countsForQuorum: {{ type: boolean }}
        onBehalfOfUserId: {NU}
        note: {{ type: [string, "null"], minLength: 1, maxLength: 1000 }}
        version: {V}
        createdAt: {TS}
        createdBy: {U}
        updatedAt: {TS}
        updatedBy: {U}
    MeetingAttendanceCreate:
      type: object
      required: [userId, attendance]
      additionalProperties: false
      properties:
        userId: {U}
        attendance: {{ type: string, enum: [present, absent, apologies] }}
        onBehalfOfUserId: {NU}
        note: {{ type: [string, "null"], minLength: 1, maxLength: 1000 }}
    MeetingAttendanceUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        attendance: {{ type: string, enum: [present, absent, apologies] }}
        onBehalfOfUserId: {NU}
        note: {{ type: [string, "null"], minLength: 1, maxLength: 1000 }}
    MeetingMinutes:
      type: object
      description: "The minutes of one meeting (REQ-S16-019 Minutes); immutable once published."
      required: [id, meetingId, body, status, approvedAt, approvedBy, publishedAt, publishedBy, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: {U}
        meetingId: {U}
        body: {{ type: string, minLength: 1, maxLength: 50000 }}
        status: {{ type: string, enum: [draft, approved, published] }}
        approvedAt: {NTS}
        approvedBy: {NU}
        publishedAt: {NTS}
        publishedBy: {NU}
        version: {V}
        createdAt: {TS}
        createdBy: {U}
        updatedAt: {TS}
        updatedBy: {U}
    MeetingMinutesCreate:
      type: object
      required: [body]
      additionalProperties: false
      properties:
        body: {{ type: string, minLength: 1, maxLength: 50000 }}
    MeetingMinutesUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        body: {{ type: string, minLength: 1, maxLength: 50000 }}
        status: {{ type: string, enum: [draft], description: "Return approved minutes to draft (the meeting's chair)." }}
    MeetingOutput:
      type: object
      required: [id, meetingId, agendaItemId, outputKind, recordType, recordId, note, createdAt, createdBy]
      additionalProperties: false
      properties:
        id: {U}
        meetingId: {U}
        agendaItemId: {NU}
        outputKind: {OUTKIND}
        recordType: {{ type: [string, "null"], enum: [decision, raid_entry, dependency, benefit, milestone, action_item, evidence, benefit_evidence, benefit_measurement, corrective_case, null] }}
        recordId: {NU}
        note: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        createdAt: {TS}
        createdBy: {U}
    MeetingOutputCreate:
      type: object
      required: [outputKind]
      additionalProperties: false
      properties:
        outputKind: {OUTKIND}
        agendaItemId: {U}
        recordType: {{ type: string, enum: [decision, raid_entry, dependency, benefit, milestone, action_item, evidence, benefit_evidence, benefit_measurement, corrective_case] }}
        recordId: {U}
        note: {{ type: string, minLength: 1, maxLength: 4000 }}
    MeetingAction:
      type: object
      description: "A meeting action link (REQ-S16-019 MeetingActionLink) with the canonical action it links."
      required: [id, meetingId, agendaItemId, actionItemId, linkKind, overdue, action, createdAt, createdBy]
      additionalProperties: false
      properties:
        id: {U}
        meetingId: {U}
        agendaItemId: {NU}
        actionItemId: {U}
        linkKind: {{ type: string, enum: [assigned, reviewed] }}
        overdue: {{ type: boolean, description: "Due date before today's business date and status open or in_progress." }}
        action: {{ $ref: "#/components/schemas/RaidAction" }}
        createdAt: {TS}
        createdBy: {U}
    MeetingActionCreate:
      type: object
      required: [title, ownerUserId]
      additionalProperties: false
      properties:
        agendaItemId: {U}
        title: {{ type: string, minLength: 1, maxLength: 500 }}
        description: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        ownerUserId: {U}
        dueDate: {NBD}
    BlockerStatus:
      type: object
      description: "A blocker's RAG in one review cycle (one meeting); append-only (REQ-PB-082)."
      required: [id, meetingId, forumId, cycleDate, sourceRecordType, sourceRecordId, rag, note, createdAt, createdBy]
      additionalProperties: false
      properties:
        id: {U}
        meetingId: {U}
        forumId: {U}
        cycleDate: {BD}
        sourceRecordType: {{ type: string, enum: [raid_entry, dependency, corrective_case, initiative, milestone] }}
        sourceRecordId: {U}
        rag: {{ type: string, enum: [red, amber, green, unknown] }}
        note: {{ type: [string, "null"], minLength: 1, maxLength: 2000 }}
        createdAt: {TS}
        createdBy: {U}
    BlockerStatusCreate:
      type: object
      required: [sourceRecordType, sourceRecordId, rag]
      additionalProperties: false
      properties:
        sourceRecordType: {{ type: string, enum: [raid_entry, dependency, corrective_case, initiative, milestone] }}
        sourceRecordId: {U}
        rag: {{ type: string, enum: [red, amber, green, unknown] }}
        note: {{ type: string, minLength: 1, maxLength: 2000 }}
    ExecutiveDecisionOptionInput:
      type: object
      required: [title]
      additionalProperties: false
      properties:
        title: {{ type: string, minLength: 1, maxLength: 300 }}
        description: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
    ExecutiveDecision:
      type: object
      description: "A T16 Executive Decision Log entry (B0130; REQ-PB-081) on the canonical decision record of kind executive. A null T16 column on an earlier record (askOrigin earlier_record) is Unknown."
      required: [id, transformationId, code, decision, whyNow, options, recommendationOptionLabel, recommendationText, ownerUserId, ownerStatus, decisionDate, impactOfDelay, outcome, chosenOptionLabel, status, overdue, askOrigin, createdSource, sourceAgendaItemId, decisionRightId, slaDueDate, slaUnknownReason, blockerRecordType, blockerRecordId, missingElements, escalationLevel, decidedAt, decidedBy, decidedOnBehalfOfUserId, version, createdAt, createdBy, updatedAt, updatedBy]
      additionalProperties: false
      properties:
        id: {U}
        transformationId: {U}
        code: {{ type: string, pattern: "^DEC-[0-9]{{2,6}}$" }}
        decision: {{ type: string, minLength: 1, maxLength: 500 }}
        whyNow: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        options: {{ type: array, maxItems: 26, items: {{ $ref: "#/components/schemas/DecisionOption" }} }}
        recommendationOptionLabel: {{ type: [string, "null"], pattern: "^[A-Z]$" }}
        recommendationText: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        ownerUserId: {NU}
        ownerStatus: {{ type: string, enum: [assigned, unassigned] }}
        decisionDate: {{ oneOf: [{BD}, {{ type: "null" }}], description: "The required date (T16 'Decision date')." }}
        impactOfDelay: {{ type: [string, "null"], minLength: 1, maxLength: 4000 }}
        outcome: {{ type: [string, "null"], minLength: 1, maxLength: 8000 }}
        chosenOptionLabel: {{ type: [string, "null"], pattern: "^[A-Z]$" }}
        status: {{ type: string, enum: [open, decided, deferred, cancelled] }}
        overdue: {{ type: boolean, description: "Open or deferred and the decision date is before today's business date." }}
        askOrigin: {{ type: string, enum: [api, agenda, blocker_escalation, earlier_record] }}
        createdSource: {{ type: [string, "null"], enum: [api, worker, null] }}
        sourceAgendaItemId: {NU}
        decisionRightId: {NU}
        slaDueDate: {NBD}
        slaUnknownReason: {{ type: [string, "null"], enum: [calendar_not_configured, no_steerco_scheduled, no_release_date, null] }}
        blockerRecordType: {{ type: [string, "null"], enum: [raid_entry, dependency, corrective_case, initiative, milestone, null] }}
        blockerRecordId: {NU}
        missingElements: {{ type: array, maxItems: 7, items: {{ type: string, enum: [decision_required, why_now, options, recommendation, impact_of_delay, decision_owner, required_date] }} }}
        escalationLevel: {{ type: integer, minimum: 0, maximum: 5 }}
        decidedAt: {NTS}
        decidedBy: {NU}
        decidedOnBehalfOfUserId: {NU}
        version: {V}
        createdAt: {TS}
        createdBy: {U}
        updatedAt: {TS}
        updatedBy: {U}
    ExecutiveDecisionCreate:
      type: object
      description: "An executive ask states all seven elements (REQ-S10-012); a missing one is a 400 with the element's pointer."
      required: [title, whyNow, options, recommendation, impactOfDelay, ownerUserId, requiredDate]
      additionalProperties: false
      properties:
        title: {{ type: string, minLength: 1, maxLength: 500, description: "The decision required." }}
        whyNow: {{ type: string, minLength: 1, maxLength: 4000 }}
        options: {{ type: array, minItems: 2, maxItems: 26, items: {{ $ref: "#/components/schemas/ExecutiveDecisionOptionInput" }}, description: "Labelled A, B, C … in order." }}
        recommendation: {{ type: string, minLength: 1, maxLength: 4000, description: "An option label (A-Z) or a recommendation text." }}
        impactOfDelay: {{ type: string, minLength: 1, maxLength: 4000 }}
        ownerUserId: {U}
        requiredDate: {BD}
        context: {{ type: string, minLength: 1, maxLength: 20000 }}
        decisionRightId: {U}
        blockerRecordType: {{ type: string, enum: [raid_entry, dependency, corrective_case, initiative, milestone] }}
        blockerRecordId: {U}
    ExecutiveDecisionUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        title: {{ type: string, minLength: 1, maxLength: 500 }}
        whyNow: {{ type: string, minLength: 1, maxLength: 4000 }}
        options: {{ type: array, minItems: 2, maxItems: 26, items: {{ $ref: "#/components/schemas/ExecutiveDecisionOptionInput" }}, description: "Replaces the active options (earlier ones are withdrawn, never deleted)." }}
        recommendation: {{ type: string, minLength: 1, maxLength: 4000 }}
        impactOfDelay: {{ type: string, minLength: 1, maxLength: 4000 }}
        ownerUserId: {U}
        requiredDate: {BD}
        context: {{ type: [string, "null"], minLength: 1, maxLength: 20000 }}
        decisionRightId: {NU}
    ExecutiveDecisionOutcome:
      type: object
      required: [outcome]
      additionalProperties: false
      properties:
        outcome: {{ type: string, enum: [decided, deferred, cancelled] }}
        chosenOptionLabel: {{ type: string, pattern: "^[A-Z]$" }}
        outcomeText: {{ type: string, minLength: 1, maxLength: 8000, description: "Required for decided and cancelled." }}
        deferUntil: {{ $ref: "#/components/schemas/BusinessDate", description: "Required for deferred; after today." }}
    DecisionEscalation:
      type: object
      description: "One escalation of an executive ask whose SLA expired (REQ-S12-011); never a decision."
      required: [id, decisionId, decisionCode, slaDueDate, businessDate, level, partyCode, targetUserId, targetGroupId, routingError, delayImpact, escalatedAt]
      additionalProperties: false
      properties:
        id: {U}
        decisionId: {U}
        decisionCode: {{ type: string }}
        slaDueDate: {BD}
        businessDate: {BD}
        level: {{ type: integer, minimum: 1, maximum: 5 }}
        partyCode: {{ oneOf: [{PARTY}, {{ type: "null" }}] }}
        targetUserId: {NU}
        targetGroupId: {NU}
        routingError: {{ type: [string, "null"], enum: [party_unmapped, party_not_executive, no_next_authority, null] }}
        delayImpact: {{ type: [string, "null"], minLength: 1, maxLength: 4000, description: "null = Impact of delay not stated." }}
        escalatedAt: {TS}
    EscalationRule:
      type: object
      required: [id, ruleKind, isDefault, enabled, escalationChain, redCycles, deadlineWorkingDays, ownerPartyCode, version, createdAt, updatedAt]
      additionalProperties: false
      properties:
        id: {NU}
        ruleKind: {{ type: string, enum: [decision_sla, blocker_red] }}
        isDefault: {{ type: boolean }}
        enabled: {{ type: boolean }}
        escalationChain: {{ type: [array, "null"], minItems: 1, maxItems: 5, items: {PARTY} }}
        redCycles: {{ type: [integer, "null"], minimum: 2, maximum: 12 }}
        deadlineWorkingDays: {{ type: [integer, "null"], minimum: 1, maximum: 60 }}
        ownerPartyCode: {{ oneOf: [{PARTY}, {{ type: "null" }}] }}
        version: {{ type: [integer, "null"], minimum: 1 }}
        createdAt: {NTS}
        updatedAt: {NTS}
    EscalationRuleCreate:
      type: object
      required: [ruleKind]
      additionalProperties: false
      properties:
        ruleKind: {{ type: string, enum: [decision_sla, blocker_red] }}
        enabled: {{ type: boolean }}
        escalationChain: {{ type: array, minItems: 1, maxItems: 5, items: {PARTY} }}
        redCycles: {{ type: integer, minimum: 2, maximum: 12 }}
        deadlineWorkingDays: {{ type: integer, minimum: 1, maximum: 60 }}
        ownerPartyCode: {PARTY}
    EscalationRuleUpdate:
      type: object
      minProperties: 1
      additionalProperties: false
      properties:
        enabled: {{ type: boolean }}
        escalationChain: {{ type: array, minItems: 1, maxItems: 5, items: {PARTY} }}
        redCycles: {{ type: integer, minimum: 2, maximum: 12 }}
        deadlineWorkingDays: {{ type: integer, minimum: 1, maximum: 60 }}
        ownerPartyCode: {PARTY}
''' + "".join(page(n, i) for n, i in [
    ("ForumPage", "Forum"), ("ForumParticipantPage", "ForumParticipant"), ("MeetingSeriesPage", "MeetingSeries"),
    ("MeetingPage", "Meeting"), ("AgendaItemPage", "AgendaItem"), ("MeetingAttendancePage", "MeetingAttendance"),
    ("MeetingOutputPage", "MeetingOutput"), ("MeetingActionPage", "MeetingAction"), ("BlockerStatusPage", "BlockerStatus"),
    ("ExecutiveDecisionPage", "ExecutiveDecision"), ("DecisionEscalationPage", "DecisionEscalation"),
    ("EscalationRulePage", "EscalationRule")])

TAGS = """  - name: forums
    description: Governance forums - the five operating-system layers of B0093 seeded verbatim per transformation - with participants, quorum, cut-off and agenda rules (P4, ADR-0032).
  - name: meeting-series
    description: Forum meeting series on a configured recurrence; a change regenerates future meetings only (P4, ADR-0032).
  - name: meetings
    description: Meetings and the committee workflow, outputs linked to canonical records, and meeting actions (P4, ADR-0032).
  - name: agenda-items
    description: Agenda items; executive asks state the decision required, why now, options, recommendation, impact of delay, owner and required date before publication (P4, ADR-0032).
  - name: attendance
    description: Meeting attendance and quorum (P4, ADR-0032).
  - name: minutes
    description: Meeting minutes - draft, approve, publish; immutable once published (P4, ADR-0032).
  - name: executive-decisions
    description: The T16 Executive Decision Log on the canonical decision record (P4, ADR-0032).
  - name: escalations
    description: Decision-SLA escalations, blocker RAG by cycle and the escalation rules (P4, ADR-0032).
"""

INFO_ADD = """
    **P4 additions, slice D (T-DG4-ARCH-05, ADR-0032).** Additive within v1: new paths, schemas and tags. The five
    operating-system layers are seeded verbatim; a recurrence change regenerates future meetings only. An executive ask
    states all seven elements, and T16 is a view of the one decision model (the DG2 decision operations are unchanged).
    Recording a T16 Outcome is a person's business decision; an escalation never decides.
"""

PERMS = ["forum.configure", "meeting.prepare", "meeting.chair", "executive_decision.create", "executive_decision.decide", "escalation_rule.configure"]


def main(path):
    s = open(path, encoding="utf-8").read()
    assert "operationId: listForums" not in s, "already applied"
    assert "  version: 1.3.0-p4\n" in s
    for key in PARAMS:
        assert f"\n    {key}:\n" not in s, key
    anchor = "    decimal strings and Unknown is never 0. A critical path is claimed only when every duration is known.\n"
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
    perm_anchor = "        - budget.edit\n    RoleCode:\n"
    assert s.count(perm_anchor) == 1
    s = s.replace(perm_anchor, "        - budget.edit\n" + "".join(f"        - {p}\n" for p in PERMS) + "    RoleCode:\n", 1)
    s = s.rstrip("\n") + "\n" + SCHEMAS
    open(path, "w", encoding="utf-8").write(s)
    print(f"added {len(OPS)} operations: " + ", ".join(o["id"] for o in OPS))


if __name__ == "__main__":
    main(sys.argv[1])
