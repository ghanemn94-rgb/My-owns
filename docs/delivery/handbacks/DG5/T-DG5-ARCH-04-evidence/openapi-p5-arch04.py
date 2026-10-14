# T-DG5-ARCH-04: appends the slice F operations (ADR-0045, ADR-0046) to docs/api/openapi.yaml (info.version stays
# 1.4.0-p5). Every P1-P4 path and every slice A-E path stays byte-stable, except: the PermissionCode enum gains the four
# P5_REPORTING_PERMISSIONS codes (the ARCH-01..03 precedent). The helper functions are copied from the T-DG5-ARCH-03
# generator. (Two status lists were corrected after the first integration run: listReportDefinitions gained 400 and
# cancelExport 403, the ADR-0007 §5b derived statuses; this file is the corrected version.) Run once from the repository root: python3 -I docs/delivery/handbacks/DG5/T-DG5-ARCH-04-evidence/openapi-p5-arch04.py
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
assert "/api/v1/report-definitions:" not in s, "already applied"

RD = (400, 401, 403, 404, 429)
LS = (400, 401, 403, 429)
paths = []
T = "/api/v1/transformations/{transformationId}"
TP = ["TransformationId"]
SNAP = T + "/report-snapshots/{snapshotId}"
SP = ["TransformationId", "ReportSnapshotId"]
UPD = T + "/updates/{updateId}"
UP = ["TransformationId", "OwnerUpdateId"]

# ---------------- reports and report snapshots (ADR-0045)
paths.append(path("/api/v1/report-definitions", [],
  op("get", "reports", "listReportDefinitions", "The twelve report definitions: the ten M0253 outputs, the executive pack and the meeting pack, with subject type, whether a reporting period is needed and the export formats each offers (authenticated; ADR-0045 §1).", schema="ReportDefinitionList", write=False, codes=(400, 401, 429))))
paths.append(path(T + "/reports/{definitionCode}/live", ["TransformationId", "ReportDefinitionCode"],
  op("get", "reports", "getLiveReport", "The live report: assembled now from the current records, never stored (transformation.read; REQ-S13-004, M0254 'Live reports may refresh'). 422 report.subject_invalid, period_required, period_not_allowed, parameters_invalid, too_large.", params=["ReportSubjectIdQuery", "ReportingPeriodIdQuery", "ReportParametersQuery"], schema="LiveReport", write=False, codes=RD + (422,))))
paths.append(path(T + "/reports/{definitionCode}/generate", ["TransformationId", "ReportDefinitionCode"],
  op("post", "reports", "generateReportSnapshot", "Generate a report snapshot: the assembled content stored with its as-of time, period, source record revisions, methodology and calculation versions, approval state and cited evidence, status generated (report.generate; REQ-S13-004, REQ-S13-007). 422 report.subject_invalid, period_required, period_not_allowed, parameters_invalid, too_large.", body="ReportGenerate", ok=201, okdesc="Created (generated).", schema="ReportSnapshot", etag=True, created=True)))
paths.append(path(T + "/report-snapshots", TP,
  op("get", "report-snapshots", "listReportSnapshots", "Report snapshots of the transformation, newest first, without their content (transformation.read).", params=["Cursor", "Limit", "ReportDefinitionCodeQuery", "ReportSnapshotStatusQuery"], schema="ReportSnapshotPage", write=False, codes=RD)))
paths.append(path(SNAP, SP,
  op("get", "report-snapshots", "getReportSnapshot", "One report snapshot with its content; an issued or superseded snapshot never changes (transformation.read; REQ-S13-007).", schema="ReportSnapshot", etag=True, write=False, codes=RD)))
paths.append(path(SNAP + "/sources", SP,
  op("get", "report-snapshots", "listReportSnapshotSources", "The source records the snapshot used, each with its revision at the as-of time, approval state and validation state (transformation.read; REQ-S13-007).", params=["Cursor", "Limit"], schema="ReportSnapshotSourcePage", write=False, codes=RD)))
paths.append(path(SNAP + "/versions", SP,
  op("get", "report-snapshots", "listReportSnapshotVersions", "The methodology, configuration and calculation versions the snapshot used (transformation.read; REQ-S13-007).", schema="ReportSnapshotVersionList", write=False, codes=RD)))
paths.append(path(SNAP + "/evidence", SP,
  op("get", "report-snapshots", "listReportSnapshotEvidence", "The evidence items the snapshot cites, with the content revision, SHA-256 and review status they had at the as-of time (transformation.read; REQ-S13-010).", params=["Cursor", "Limit"], schema="ReportSnapshotEvidencePage", write=False, codes=RD)))
paths.append(path(SNAP + "/issue", SP,
  op("post", "report-snapshots", "issueReportSnapshot", "Issue a generated snapshot as the next issue version of its series; issuing a reissue supersedes the previous issue (report.issue; TL, TO, SEC; REQ-S13-007). Issuing approves nothing. 422 report_snapshot.not_generated; 409 report_snapshot.series_changed.", body="ReportSnapshotIssue", schema="ReportSnapshot", etag=True, ifmatch="IfMatch")))
paths.append(path(SNAP + "/discard", SP,
  op("post", "report-snapshots", "discardReportSnapshot", "Discard a generated snapshot with a reason; it is kept, never deleted (report.issue). 422 report_snapshot.not_generated.", body="ReportSnapshotReason", schema="ReportSnapshot", etag=True, ifmatch="IfMatch")))
paths.append(path(SNAP + "/reissue", SP,
  op("post", "report-snapshots", "reissueReportSnapshot", "Generate a reissue of the current issued snapshot from the current records, in the same series, with a reason; the issued snapshot stays unchanged until the reissue is issued (report.issue; REQ-S13-007). 422 report_snapshot.not_issued, report.too_large.", body="ReportSnapshotReason", ok=201, okdesc="Created (the reissue, generated).", schema="ReportSnapshot", etag=True, created=True, ifmatch="IfMatch")))

# ---------------- exports (ADR-0046)
paths.append(path("/api/v1/exports", [],
  op("get", "exports", "listExports", "Your export jobs, newest first, with status and progress (authenticated; own jobs only).", params=["Cursor", "Limit", "ExportStatusQuery"], schema="ExportJobPage", write=False, codes=LS),
  op("post", "exports", "createExport", "Export a report snapshot, or a live selection (which generates its snapshot first), as PDF, DOCX, XLSX, PPTX or CSV in English or Arabic; rendered by the worker, with progress (export.create, plus report.generate for a live selection; REQ-S13-005, REQ-S13-009). The same Idempotency-Key returns the existing job with 200. 422 export.format_not_offered, export.snapshot_discarded, report.*.", params=["IdempotencyKey"], body="ExportCreate", ok=202, okdesc="Accepted (queued).", schema="ExportJob", etag=True, extra_ok=("200", "The existing job for this Idempotency-Key.", "ExportJob"))))
paths.append(path("/api/v1/exports/{exportId}", ["ExportId"],
  op("get", "exports", "getExport", "One of your export jobs: status, stage, percent and sections done; the file's name, type, size and SHA-256 once it succeeded (requester; transformation.read re-checked; others 404).", schema="ExportJob", etag=True, write=False, codes=(400, 401, 404, 429))))
paths.append(path("/api/v1/exports/{exportId}/download", ["ExportId"],
  op("get", "exports", "downloadExport", "Download the exported file (attachment; ETag = its SHA-256; requester only, transformation.read re-checked; others 404). 409 export.not_ready; 422 export.failed.", ok=200, okdesc="The file bytes (Content-Disposition attachment).", binary=True, write=False, codes=(400, 401, 404, ("409", "VersionConflict"), 422, 429))))
paths.append(path("/api/v1/exports/{exportId}/cancel", ["ExportId"],
  op("post", "exports", "cancelExport", "Cancel one of your queued or running exports (requester). 422 export.not_cancellable.", schema="ExportJob", etag=True, ifmatch="IfMatch", codes=(400, 401, 403, 404, 422, 429))))

# ---------------- presentation (ADR-0045 §7)
paths.append(path(T + "/meetings/{meetingId}/presentation", ["TransformationId", "MeetingId"],
  op("get", "meetings", "getMeetingPresentation", "Read-only presentation of a meeting: live from its agenda, linked decision briefs, asks and actions, or the stored content of one of its meeting-pack snapshots (transformation.read; REQ-S10-013). 422 presentation.snapshot_mismatch.", params=["ReportSnapshotIdQuery"], schema="MeetingPresentation", write=False, codes=RD + (422,))))

# ---------------- owner updates (ADR-0045 §6)
paths.append(path(T + "/updates", TP,
  op("get", "owner-updates", "listOwnerUpdates", "Structured owner updates of the transformation and its workstreams, per reporting period (transformation.read; REQ-S09-011).", params=["Cursor", "Limit", "ReportingPeriodIdQuery", "OwnerUpdateSubjectTypeQuery", "OwnerUpdateStatusQuery"], schema="OwnerUpdatePage", write=False, codes=RD),
  op("post", "owner-updates", "createOwnerUpdate", "Start the draft update of a subject you own for an open reporting period (owner_update.submit; the workstream lead, or the transformation's TL). 403 owner_update.not_owner; 409 owner_update.exists; 422 owner_update.period_not_open.", body="OwnerUpdateCreate", ok=201, okdesc="Created (draft).", schema="OwnerUpdate", etag=True, created=True, codes=(400, 401, 403, 404, ("409", "Duplicate"), 422, 429))))
paths.append(path(UPD, UP,
  op("get", "owner-updates", "getOwnerUpdate", "One owner update (transformation.read).", schema="OwnerUpdate", etag=True, write=False, codes=RD),
  op("patch", "owner-updates", "updateOwnerUpdate", "Change the eight fields of a draft update (owner_update.submit; owner). 403 owner_update.not_owner; 422 owner_update.not_draft, owner_update.period_not_open.", body="OwnerUpdatePatch", schema="OwnerUpdate", etag=True, ifmatch="IfMatch")))
paths.append(path(UPD + "/submit", UP,
  op("post", "owner-updates", "submitOwnerUpdate", "Submit the draft update as its next revision (owner_update.submit; owner). 403 owner_update.not_owner; 422 owner_update.not_draft, owner_update.empty, owner_update.period_not_open.", schema="OwnerUpdate", etag=True, ifmatch="IfMatch")))
paths.append(path(UPD + "/reopen", UP,
  op("post", "owner-updates", "reopenOwnerUpdate", "Reopen a submitted update as a draft, with a reason, while its period is open (owner_update.submit; owner). 422 owner_update.not_submitted, owner_update.period_not_open.", body="OwnerUpdateReopen", schema="OwnerUpdate", etag=True, ifmatch="IfMatch")))
paths.append(path(UPD + "/revisions", UP,
  op("get", "owner-updates", "listOwnerUpdateRevisions", "The submitted revisions of an update, newest first (transformation.read).", params=["Cursor", "Limit"], schema="OwnerUpdateRevisionPage", write=False, codes=RD)))

# ---------------- evidence (ADR-0045 §8)
paths.append(path(T + "/evidence-register", TP,
  op("get", "evidence", "listEvidenceRegister", "The evidence register: per item its linked records, type, source, owner, observation period, upload date, version, checksum and review status (transformation.read; REQ-S13-010).", params=["Cursor", "Limit", "EvidenceReviewStatusQuery", "EvidenceTypeQuery", "EvidenceRecordTypeQuery"], schema="EvidenceRegisterPage", write=False, codes=RD)))
paths.append(path(T + "/evidence/{evidenceId}/versions", ["TransformationId", "EvidenceId"],
  op("get", "evidence", "listEvidenceVersions", "The content revisions of a file evidence item, newest first: revision, SHA-256, size, type, file name, uploader and upload time (transformation.read; REQ-S13-010).", params=["Cursor", "Limit"], schema="EvidenceVersionPage", write=False, codes=RD)))

old_enum = "        - gate_condition.close\n    RoleCode:\n"
assert s.count(old_enum) == 1
s = s.replace(old_enum, "        - gate_condition.close\n" + "".join(f"        - {c}\n" for c in [
    "report.generate", "report.issue", "export.create", "owner_update.submit"]) + "    RoleCode:\n", 1)

anchor = "\ncomponents:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, "\n" + "".join(paths) + "components:\n", 1)

tags = """  - name: reports
    description: The generated outputs (the ten M0253 outputs, the executive pack and the meeting pack), live and generated (P5, ADR-0045).
  - name: report-snapshots
    description: Immutable report snapshots with as-of time, period, source record revisions, methodology and calculation versions, approval state and cited evidence; issue, reissue as a new version, discard (P5, ADR-0045).
  - name: exports
    description: Server-side PDF, DOCX, XLSX, PPTX and CSV exports of report snapshots in English or Arabic, as asynchronous jobs with progress (P5, ADR-0046).
  - name: owner-updates
    description: Structured owner updates per reporting period that the executive pack is generated from (P5, ADR-0045).
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

params = """    ReportDefinitionCode:
      name: definitionCode
      in: path
      required: true
      schema: { $ref: "#/components/schemas/ReportDefinitionCode" }
    ReportSnapshotId:
      name: snapshotId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    ExportId:
      name: exportId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    OwnerUpdateId:
      name: updateId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    ReportSubjectIdQuery:
      name: subjectId
      in: query
      required: false
      description: The subject record (meeting, gate instance, business case or BAU handover); omitted for outputs about the transformation itself.
      schema: { $ref: "#/components/schemas/Uuid" }
    ReportParametersQuery:
      name: parameters
      in: query
      required: false
      description: "The output's settings as a JSON object (at most 8192 bytes), e.g. registers: {\\"register\\":\\"raid\\",\\"filters\\":{...}} with the register list route's filters (ADR-0045 §1)."
      schema: { type: string, maxLength: 8192 }
    ReportDefinitionCodeQuery:
      name: definitionCode
      in: query
      required: false
      schema: { $ref: "#/components/schemas/ReportDefinitionCode" }
    ReportSnapshotStatusQuery:
      name: status
      in: query
      required: false
      schema: { type: string, enum: [generated, issued, superseded, discarded] }
    ReportSnapshotIdQuery:
      name: snapshotId
      in: query
      required: false
      schema: { $ref: "#/components/schemas/Uuid" }
    ExportStatusQuery:
      name: status
      in: query
      required: false
      schema: { type: string, enum: [queued, running, succeeded, failed, cancelled] }
    OwnerUpdateStatusQuery:
      name: status
      in: query
      required: false
      schema: { type: string, enum: [draft, submitted] }
    OwnerUpdateSubjectTypeQuery:
      name: subjectType
      in: query
      required: false
      schema: { type: string, enum: [transformation, workstream] }
    EvidenceReviewStatusQuery:
      name: reviewStatus
      in: query
      required: false
      schema: { type: string, enum: [unverified, verified, rejected] }
    EvidenceTypeQuery:
      name: evidenceType
      in: query
      required: false
      schema: { type: string, enum: [document, data_extract, analysis, interview, observation, system_report, other] }
    EvidenceRecordTypeQuery:
      name: recordType
      in: query
      required: false
      schema: { type: string, pattern: "^[a-z][a-z0-9_]{1,63}$" }
"""
anchor = "\n  parameters:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + params, 1)

schemas = []
schemas.append("    ReportDefinitionCode:\n      type: string\n      enum: [" + ", ".join(DEFS) + "]\n")
schemas.append(obj("ReportDefinition", None, [("code", REF("ReportDefinitionCode")), ("ordinal", "{ type: integer, minimum: 1 }"),
  ("outputKind", ENUM("generated_output", "executive_pack", "meeting_pack")), ("subjectType", SUBJ), ("needsReportingPeriod", "{ type: boolean }"),
  ("formats", "{ type: array, minItems: 1, maxItems: 5, items: " + FORMAT + " }"), ("labelEn", STR), ("labelAr", STR), ("descriptionEn", STR),
  ("descriptionAr", STR), ("sourceRef", STR), ("playbookRef", NSTR)]))
schemas.append(obj("ReportDefinitionList", None, [("items", ARR("ReportDefinition"))]))
schemas.append("""    ReportDocument:
      type: object
      description: "The assembled document model, content schema version 1 (ADR-0045 §3; validated by the Zod schema ReportDocument in @mth/shared/schemas). Labels are i18n keys translated at render time; every value carries its validation state (validated, provisional, unknown, stale, not_applicable); unknown and stale values have no number."
      required: [schemaVersion, definitionCode, transformation, subject, period, asOf, methodology, approvalState, sections]
      additionalProperties: true
      properties:
        schemaVersion: { type: integer, enum: [1] }
        definitionCode: { $ref: "#/components/schemas/ReportDefinitionCode" }
        transformation: { type: object }
        subject: { type: object }
        period: { type: [object, "null"] }
        asOf: { $ref: "#/components/schemas/Timestamp" }
        methodology: { type: object }
        approvalState: """ + APPROVAL + """
        sections: { type: array, items: { type: object } }
""")
schemas.append(obj("LiveReport", None, [("snapshotId", "{ type: \"null\" }"), ("document", REF("ReportDocument"))]))
schemas.append(obj("ReportGenerate", "subjectId for outputs about a record; reportingPeriodId for executive_dashboard and executive_pack; parameters for registers.",
  [("subjectId", U), ("reportingPeriodId", U), ("parameters", "{ type: object }")], required=[]))
summary_props = [("id", U), ("transformationId", U), ("definitionCode", REF("ReportDefinitionCode")), ("subjectType", SUBJ), ("subjectId", U),
  ("reportingPeriodId", NU), ("periodLabel", NSTR), ("periodStart", NBD), ("periodEnd", NBD), ("asOf", TS), ("methodologyVersionId", U),
  ("approvalState", APPROVAL), ("provisionalValueCount", INT0), ("unknownValueCount", INT0), ("contentSha256", SHA), ("seriesId", U),
  ("reissueOfId", NU), ("reissueReason", NTXT(3, 1000)), ("status", SNAPSTATUS), ("issueVersion", NINT1), ("issuedAt", NTS), ("issuedBy", NU),
  ("issueNote", NTXT(1, 1000)), ("supersededAt", NTS), ("supersededById", NU), ("discardedAt", NTS), ("discardedBy", NU),
  ("discardReason", NTXT(3, 1000)), ("version", VER), ("createdAt", TS), ("createdBy", U)]
schemas.append(obj("ReportSnapshotSummary", None, summary_props))
schemas.append(obj("ReportSnapshot", "A report snapshot (ADR-0045 §2-§4). Its content and context never change after it is generated.",
  summary_props + [("parameters", "{ type: object }"), ("content", REF("ReportDocument"))]))
schemas.append(page("ReportSnapshotPage", "ReportSnapshotSummary"))
schemas.append(obj("ReportSnapshotSource", None, [("id", U), ("sectionKey", STR), ("recordType", STR), ("recordId", U),
  ("recordVersion", "{ type: integer, minimum: 1 }"), ("recordUpdatedAt", NTS), ("approvalState", SRC_APPROVAL), ("validationState", VALID)]))
schemas.append(page("ReportSnapshotSourcePage", "ReportSnapshotSource"))
schemas.append(obj("ReportSnapshotVersion", None, [("versionKind", ENUM("methodology_version", "config_version", "kpi_version", "formula_version", "weight_set", "calculation_engine", "scoring_scheme")),
  ("referenceId", NU), ("referenceKey", STR), ("versionLabel", STR)]))
schemas.append(obj("ReportSnapshotVersionList", None, [("items", ARR("ReportSnapshotVersion"))]))
schemas.append(obj("ReportSnapshotEvidenceItem", None, [("sectionKey", STR), ("evidenceId", U), ("contentId", NU),
  ("contentRevision", NINT1), ("contentSha256", NSHA), ("reviewStatus", ENUM("unverified", "verified", "rejected"))]))
schemas.append(page("ReportSnapshotEvidencePage", "ReportSnapshotEvidenceItem"))
schemas.append(obj("ReportSnapshotIssue", None, [("note", NTXT(1, 1000))], required=[]))
schemas.append(obj("ReportSnapshotReason", None, [("reason", TXT(3, 1000))]))
schemas.append(obj("ExportLiveSelection", None, [("definitionCode", REF("ReportDefinitionCode")), ("subjectId", U), ("reportingPeriodId", U),
  ("parameters", "{ type: object }")], required=["definitionCode"]))
schemas.append(obj("ExportCreate", "Exactly one of snapshotId (an existing snapshot) or report (a live selection; its snapshot is generated first).",
  [("snapshotId", U), ("report", REF("ExportLiveSelection")), ("format", FORMAT), ("language", ENUM("en", "ar"))], required=["format", "language"],
  extra="      oneOf:\n        - required: [snapshotId]\n        - required: [report]\n"))
schemas.append(obj("ExportJob", "An export job (ADR-0046 §5); the file fields are set exactly when status is succeeded.", [("id", U), ("transformationId", U), ("snapshotId", U),
  ("format", FORMAT), ("language", ENUM("en", "ar")), ("status", ENUM("queued", "running", "succeeded", "failed", "cancelled")),
  ("stage", ENUM("queued", "loading", "rendering", "storing", "done")), ("percent", "{ type: integer, minimum: 0, maximum: 100 }"),
  ("sectionsDone", INT0), ("sectionsTotal", '{ type: [integer, "null"], minimum: 0 }'), ("attemptCount", INT0), ("startedAt", NTS), ("finishedAt", NTS),
  ("fileName", NSTR), ("contentType", NSTR), ("fileSha256", NSHA), ("fileSizeBytes", '{ type: [integer, "null"], minimum: 1 }'),
  ("errorCode", '{ type: [string, "null"], enum: [export.render_failed, export.too_large, export.source_unavailable, export.retries_exhausted, null] }'),
  ("cancelledAt", NTS), ("version", VER), ("createdAt", TS)]))
schemas.append(page("ExportJobPage", "ExportJob"))
schemas.append(obj("MeetingPresentation", "Read-only presentation of a meeting (ADR-0045 §7): live, or the stored content of a meeting-pack snapshot.",
  [("meetingId", U), ("mode", ENUM("live", "snapshot")), ("snapshotId", NU), ("document", REF("ReportDocument"))]))
FIELDS = ["achievements", "nextSteps", "milestones", "outcomes", "adoption", "risks", "dependencies", "asks"]
schemas.append(obj("OwnerUpdate", "A structured owner update per subject and reporting period (ADR-0045 §6; M0185).", [("id", U), ("transformationId", U),
  ("subjectType", ENUM("transformation", "workstream")), ("subjectId", U), ("reportingPeriodId", U), ("periodLabel", STR), ("ownerUserId", U)]
  + [(f, NTXT(1, 2000)) for f in FIELDS]
  + [("status", ENUM("draft", "submitted")), ("revisionNo", INT0), ("submittedAt", NTS), ("submittedBy", NU), ("reopenReason", NTXT(3, 1000)),
     ("version", VER), ("createdAt", TS), ("updatedAt", TS)]))
schemas.append(page("OwnerUpdatePage", "OwnerUpdate"))
schemas.append(obj("OwnerUpdateCreate", None, [("subjectType", ENUM("transformation", "workstream")), ("subjectId", U), ("reportingPeriodId", U)]
  + [(f, NTXT(1, 2000)) for f in FIELDS], required=["subjectType", "subjectId", "reportingPeriodId"]))
schemas.append(obj("OwnerUpdatePatch", "At least one of the eight fields; null clears a field.", [(f, NTXT(1, 2000)) for f in FIELDS], required=[],
  extra="      minProperties: 1\n"))
schemas.append(obj("OwnerUpdateReopen", None, [("reason", TXT(3, 1000))]))
schemas.append(obj("OwnerUpdateRevision", None, [("revisionNo", "{ type: integer, minimum: 1 }")] + [(f, NTXT(1, 2000)) for f in FIELDS]
  + [("submittedAt", TS), ("submittedBy", U)]))
schemas.append(page("OwnerUpdateRevisionPage", "OwnerUpdateRevision"))
schemas.append(obj("EvidenceRegisterLink", None, [("recordType", STR), ("recordId", U), ("via", STR)]))
schemas.append(obj("EvidenceRegisterItem", "One evidence item with the M0255 fields (ADR-0045 §8). Null source or observation period is shown as Not stated; checksum and revision exist for files only.",
  [("evidenceId", U), ("title", STR), ("kind", ENUM("file", "note", "external_link", "file_reference")),
   ("evidenceType", ENUM("document", "data_extract", "analysis", "interview", "observation", "system_report", "other")), ("source", NSTR),
   ("ownerUserId", U), ("observationStart", NBD), ("observationEnd", NBD), ("uploadedAt", TS), ("currentRevision", NINT1), ("recordVersion", VER),
   ("sha256", NSHA), ("reviewStatus", ENUM("unverified", "verified", "rejected")), ("accessibilityStatus", ENUM("unchecked", "accessible", "inaccessible")),
   ("status", ENUM("active", "archived")), ("links", ARR("EvidenceRegisterLink"))]))
schemas.append(page("EvidenceRegisterPage", "EvidenceRegisterItem"))
schemas.append(obj("EvidenceVersion", None, [("contentId", U), ("revision", "{ type: integer, minimum: 1 }"), ("sha256", SHA),
  ("sizeBytes", INT0), ("contentType", STR), ("fileName", STR), ("uploadedBy", U), ("uploadedAt", TS)]))
schemas.append(page("EvidenceVersionPage", "EvidenceVersion"))

anchor = "\n  schemas:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + "".join(schemas), 1)
open(F, "w").write(s)
print("operations added:", sum(p.count("operationId:") for p in paths))
