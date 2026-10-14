# T-DG5-ARCH-02: appends the slice B and C operations (ADR-0041, ADR-0042) to docs/api/openapi.yaml (info.version stays
# 1.4.0-p5). Every P1-P4 path and every slice A path stays byte-stable; two slice A enums gain values (ConfigElementType:
# form, form_field; PermissionCode: the five P5_FORMS_PROCEDURES_PERMISSIONS codes). Run once from the repository root.
F = "docs/api/openapi.yaml"
s = open(F).read()
assert "/api/v1/admin/form-schemas:" not in s, "already applied"
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

RD = (400, 401, 403, 404, 429)
T = "/api/v1/transformations/{transformationId}"
FR = T + "/form-records/{recordType}"
REC = FR + "/{recordId}"
TP = ["TransformationId", "FormRecordTypePath"]
RP = TP + ["FormRecordIdPath"]
paths = []
# ---------------- Slice B: forms (ADR-0041)
paths.append(path("/api/v1/admin/form-schemas", [],
  op("get", "forms", "listFormRecordTypes", "The native forms: templates, source deliverables, the twelve extension record types (with the extension badge) and product records, with their write permission, extension-field and bulk-edit flags and feature status (methodology.read; ADR-0041 §1).", params=["FormRecordKindQuery"], schema="FormRecordTypeList", write=False, codes=(400, 401, 403, 429))))
paths.append(path("/api/v1/admin/form-schemas/{recordType}", ["FormRecordTypePath"],
  op("get", "forms", "getFormSchemaAdmin", "The resolved form of one record type in a form_schema version (default: the newest published): protected source columns and extension fields with labels, help, type and settings. Studio edits use putConfigElement/removeConfigElement with elementType form or form_field and publish through publishConfigVersion (methodology.read).", params=["ConfigVersionIdQuery"], schema="FormSchema", write=False, codes=RD)))
paths.append(path(T + "/form-schemas/{recordType}", TP,
  op("get", "forms", "getTransformationFormSchema", "The form of one record type in the form_schema version the transformation is pinned to (else forms v1): inline help, validation settings, protected and extension flags, and the extension badge (transformation.read). 422 form_record.type_planned.", schema="FormSchema", write=False, codes=(400, 401, 403, 404, 422, 429))))
paths.append(path(REC + "/custom-fields", RP,
  op("get", "forms", "getFormRecordCustomFields", "The extension-field values of one record, with calculated fields evaluated (Not computable with the missing field named, never 0) and the version they were validated against; version 0 when none stored (transformation.read).", schema="FormCustomValues", etag=True, write=False, codes=RD),
  op("put", "forms", "putFormRecordCustomFields", "Replace the extension-field values of one record, validated before persistence against the pinned form_schema version: decimals as strings, percentages as fractions (12% -> 0.12), currency as amount + code, calculated fields refused. If-Match is the values' version, 0 to create (the record type's write permission). 400 validation.*; 409 form_record.conflict; 422 form_record.custom_field_unknown, custom_field_required, type_planned; form_schema.extensions_not_allowed.", body="FormCustomValuesPut", schema="FormCustomValues", etag=True, ifmatch="IfMatchOrZero")))
paths.append(path(REC + "/versions", RP,
  op("get", "forms", "listFormRecordVersions", "Version history of one record from the audit trail: version, actor, time, action and changed field names, oldest first (transformation.read).", params=["Cursor", "Limit"], schema="FormRecordVersionPage", write=False, codes=RD)))
paths.append(path(REC + "/comments", RP,
  op("get", "forms", "listFormRecordComments", "Comments on one record with one reply level, oldest first (transformation.read).", params=["Cursor", "Limit"], schema="FormRecordCommentPage", write=False, codes=RD),
  op("post", "forms", "createFormRecordComment", "Add a comment or a reply to a top-level comment; comments are append-only (form_record.comment). 422 form_comment.parent_invalid.", body="FormRecordCommentCreate", ok=201, okdesc="Created.", schema="FormRecordComment", created=True)))
paths.append(path(REC + "/attachments", RP,
  op("get", "forms", "listFormRecordAttachments", "Evidence attached to one record: the DG2 evidence links for their twenty record types, else the P5 attachments (transformation.read).", params=["Cursor", "Limit", "IncludeRemovedQuery"], schema="FormRecordAttachmentPage", write=False, codes=RD),
  op("post", "forms", "attachFormRecordEvidence", "Attach evidence of the same transformation to one record (the record type's write permission). 409 the evidence is already attached; 422 form_attachment.evidence_unknown.", body="FormRecordAttachmentCreate", ok=201, okdesc="Created.", schema="FormRecordAttachment", created=True, etag=True, codes=(400, 401, 403, 404, ("409", "Duplicate"), 422, 429))))
paths.append(path(REC + "/attachments/{attachmentId}/remove", RP + ["FormAttachmentId"],
  op("post", "forms", "removeFormRecordAttachment", "Remove an attachment with a reason; the evidence itself is unchanged (the record type's write permission). 422 form_attachment.already_removed.", body="FormRecordAttachmentRemove", schema="FormRecordAttachment", etag=True, ifmatch="IfMatch")))
paths.append(path(FR + "/export", TP,
  op("get", "forms", "exportFormRecords", "Export the records of one form in the transformation: source columns and the pinned version's extension fields, decimals as strings, Unknown and Not computable marked, never 0; at most 5000 rows (transformation.read). 422 form_export.too_large, form_record.type_planned.", params=["ExportFormatQuery", "ExportLanguageQuery"], schema="FormRecordExport", write=False, codes=(400, 401, 403, 404, 422, 429), csv=True)))
paths.append(path(FR + "/bulk", TP,
  op("post", "forms", "bulkUpdateFormRecords", "Bulk edit 1-100 records all-or-nothing: bulk-editable source columns through the register's own update, and extension-field values; every item carries its version (the record type's write permission). 409 form_record.bulk_conflict lists the stale items; 422 form_record.bulk_not_allowed, bulk_field_not_editable, bulk_too_many.", body="FormBulkUpdate", schema="FormBulkUpdateResult", codes=(400, 401, 403, 404, 409, 422, 429))))
paths.append(path(T + "/form-drafts", ["TransformationId"],
  op("get", "forms", "listFormDrafts", "The caller's own drafts in the transformation, newest first (transformation.read; own drafts only).", params=["Cursor", "Limit", "FormRecordTypeQuery", "FormDraftStatusQuery"], schema="FormDraftPage", write=False, codes=RD),
  op("post", "forms", "createFormDraft", "Save a draft of a new record or of an existing record (with its current version) (the record type's write permission). 409 form_draft.open_exists; 422 form_record.type_planned.", body="FormDraftCreate", ok=201, okdesc="Created (open).", schema="FormDraft", etag=True, created=True, codes=(400, 401, 403, 404, ("409", "Duplicate"), 422, 429))))
paths.append(path(T + "/form-drafts/{draftId}", ["TransformationId", "FormDraftId"],
  op("get", "forms", "getFormDraft", "Reopen one of the caller's drafts; baseChanged tells whether the record moved past the draft's base version (owner only; others 404).", schema="FormDraft", etag=True, write=False, codes=RD),
  op("put", "forms", "updateFormDraft", "Replace the payload of an open draft (owner only). 422 form_draft.closed.", body="FormDraftUpdate", schema="FormDraft", etag=True, ifmatch="IfMatch")))
paths.append(path(T + "/form-drafts/{draftId}/close", ["TransformationId", "FormDraftId"],
  op("post", "forms", "closeFormDraft", "Close an open draft as saved (after the record write succeeded) or discarded; a closed draft never changes (owner only). 422 form_draft.closed.", body="FormDraftClose", schema="FormDraft", etag=True, ifmatch="IfMatch")))
# ---------------- Slice C: procedures (ADR-0042)
paths.append(path("/api/v1/procedure-definitions", [],
  op("get", "procedures", "listProcedureDefinitions", "Procedure definitions of a procedures version (default: the newest published), in order, with their M0152 parts and steps (procedure.read).", params=["Cursor", "Limit", "ConfigVersionIdQuery", "IncludeRemovedQuery"], schema="ProcedureDefinitionPage", write=False, codes=RD)))
paths.append(path("/api/v1/procedure-definitions/validate", [],
  op("post", "procedures", "validateProcedureDefinition", "Validate a definition body without saving it: trigger, completion condition, steps, parallel groups, conditions, inputs, roles and outputs; returns every finding (methodology.configure). Nothing is written.", body="ProcedureDefinitionInput", schema="ProcedureValidationReport", codes=(400, 401, 403, 429))))
paths.append(path("/api/v1/procedure-definitions/{procedureCode}", ["ProcedureCodePath"],
  op("get", "procedures", "getProcedureDefinition", "One procedure definition in a procedures version (default: the newest published) (procedure.read).", params=["ConfigVersionIdQuery"], schema="ProcedureDefinition", etag=True, write=False, codes=RD)))
paths.append(path("/api/v1/admin/procedure-definitions/{versionId}/{procedureCode}", ["ConfigVersionId", "ProcedureCodePath"],
  op("put", "procedures", "putProcedureDefinition", "Create or replace one definition with its steps in a procedures draft being edited; If-Match is the draft's version. Publish, review and rollback use the slice A operations (methodology.configure; ADM_METHOD). 409 config_version.not_editable; 422 procedure_definition.trigger_required, completion_required, steps_required, parallel_group_invalid, condition_invalid, input_unknown, input_schema_invalid, role_not_allowed, approval_step_invalid, code_invalid.", body="ProcedureDefinitionInput", schema="ProcedureDefinition", etag=True, ifmatch="IfMatch")))
paths.append(path("/api/v1/admin/procedure-definitions/{versionId}/{procedureCode}/remove", ["ConfigVersionId", "ProcedureCodePath"],
  op("post", "procedures", "removeProcedureDefinition", "Mark an admin-authored definition removed in a procedures draft; seeded procedures are refused (methodology.configure). 409 config_version.not_editable; 422 procedure_definition.source_protected.", schema="ConfigVersion", etag=True, ifmatch="IfMatch")))
paths.append(path("/api/v1/procedure-instances", [],
  op("get", "procedures", "listProcedureInstances", "Procedure instances in the caller's scope, newest first, by transformation, status and procedure (procedure.read).", params=["Cursor", "Limit", "TransformationIdQuery", "ProcedureInstanceStatusQuery", "ProcedureCodeQuery"], schema="ProcedureInstancePage", write=False, codes=(400, 401, 403, 429)),
  op("post", "procedures", "launchProcedureInstance", "Launch a published procedure: creates the instance pinned to the definition version, its steps, and activates the first position (procedure.launch and one of the definition's launch roles). 403 procedure.launch_role; 422 procedure.not_published, scope_mismatch, input_invalid.", params=["IdempotencyKey"], body="ProcedureLaunch", ok=201, okdesc="Created (active).", schema="ProcedureInstance", etag=True, created=True)))
PI = "/api/v1/procedure-instances/{instanceId}"
paths.append(path(PI, ["ProcedureInstanceId"],
  op("get", "procedures", "getProcedureInstance", "One instance: pinned definition version, current step(s), assignees, due dates (Unknown without a calendar), missing inputs, completed evidence, outputs and the next action (procedure.read in scope).", schema="ProcedureInstance", etag=True, write=False, codes=RD)))
paths.append(path(PI + "/inputs", ["ProcedureInstanceId"],
  op("patch", "procedures", "updateProcedureInstanceInputs", "Merge input values into an active instance; each is validated against the pinned input schema (procedure.act). 422 procedure.input_invalid, procedure.not_active.", body="ProcedureInputsUpdate", schema="ProcedureInstance", etag=True, ifmatch="IfMatch")))
ST = PI + "/steps/{stepKey}"
SP = ["ProcedureInstanceId", "ProcedureStepKeyPath"]
paths.append(path(ST + "/complete", SP,
  op("post", "procedures", "completeProcedureStep", "Complete an active task step: required inputs present, evidence linked when required, the output record produced or linked by its adapter; then the next position activates or conditional steps become not applicable (procedure.act; the assignee or a holder of its role). 403 procedure_step.not_assignee; 422 procedure_step.not_active, inputs_missing, evidence_required, output_required, output_record_invalid, decided_through_approval.", body="ProcedureStepComplete", schema="ProcedureInstance", etag=True, ifmatch="IfMatch")))
paths.append(path(ST + "/skip", SP,
  op("post", "procedures", "skipProcedureStep", "Skip an active skippable step with a reason (procedure.act). 422 procedure_step.not_skippable, not_active.", body="ProcedureStepSkip", schema="ProcedureInstance", etag=True, ifmatch="IfMatch")))
paths.append(path(ST + "/assign", SP,
  op("post", "procedures", "assignProcedureStep", "Assign a pending or active step to a person who holds its role in scope (procedure.manage). 422 procedure_step.not_active.", body="ProcedureStepAssign", schema="ProcedureInstance", etag=True, ifmatch="IfMatch")))
paths.append(path(ST + "/evidence", SP,
  op("post", "procedures", "linkProcedureStepEvidence", "Link evidence of the instance's transformation to an active step; links are append-only (procedure.act). 422 procedure_step.not_active, procedure_step.output_record_invalid.", body="ProcedureStepEvidence", schema="ProcedureInstance", etag=True, ifmatch="IfMatch")))
paths.append(path(PI + "/cancel", ["ProcedureInstanceId"],
  op("post", "procedures", "cancelProcedureInstance", "Cancel an active instance with a reason; its open steps are cancelled; outputs already linked stay (procedure.manage). 422 procedure.not_active.", body="ProcedureCancel", schema="ProcedureInstance", etag=True, ifmatch="IfMatch")))
paths.append(path("/api/v1/me/procedure-steps", [],
  op("get", "procedures", "listMyProcedureSteps", "My procedures: active steps assigned to the caller, or unassigned steps of a role the caller holds in scope, by due date (Unknown last) (procedure.read).", params=["Cursor", "Limit"], schema="MyProcedureStepPage", write=False, codes=(400, 401, 403, 429))))
paths.append(path("/api/v1/admin/coverage", [],
  op("get", "procedures", "getMethodologyCoverage", "The methodology coverage view: every counted source element with its linked forms and procedures and a live status Covered, Planned or Not covered (never green for planned or missing), with integer totals (methodology.read; REQ-S01-003).", params=["ConfigVersionIdQuery"], schema="MethodologyCoverage", write=False, codes=RD)))

old_enum = "        - methodology_migration.execute\n    RoleCode:\n"
assert s.count(old_enum) == 1
s = s.replace(old_enum, "        - methodology_migration.execute\n" + "".join(f"        - {c}\n" for c in [
    "form_record.comment", "procedure.read", "procedure.launch", "procedure.act", "procedure.manage"]) + "    RoleCode:\n", 1)
old_et = "scoring_weight, scoring_rubric]\n"
assert s.count("    ConfigElementType:\n      type: string\n      enum: [methodology_text, phase, gate, gate_criterion, mandatory_artifact, checklist_item, template, tom_dimension, approver_route, reminder, escalation_rule, dashboard, report_layout, source_element, scoring_weight, scoring_rubric]\n") == 1
s = s.replace("source_element, scoring_weight, scoring_rubric]\n", "source_element, scoring_weight, scoring_rubric, form, form_field]\n", 1)

anchor = "\ncomponents:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, "\n" + "".join(paths) + "components:\n", 1)

tags = """  - name: forms
    description: Native forms on one common framework - form schema versions, protected source columns, extension fields, custom-field values, drafts, version history, comments, attachments, export and bulk edit (P5, ADR-0041).
  - name: procedures
    description: Procedure definitions versioned through Studio, persistent procedure instances pinned to the definition version with outputs as linked records, my procedures and the methodology coverage view (P5, ADR-0042).
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
FRT = '{ $ref: "#/components/schemas/FormRecordTypeCode" }'
FT = '{ $ref: "#/components/schemas/FormFieldType" }'
TXT = lambda lo, hi: f"{{ type: string, minLength: {lo}, maxLength: {hi} }}"
NTXT = lambda lo, hi: f'{{ type: [string, "null"], minLength: {lo}, maxLength: {hi} }}'
REF = lambda n: f'{{ $ref: "#/components/schemas/{n}" }}'
ARR = lambda n, mx=None: f'{{ type: array{", maxItems: " + str(mx) if mx else ""}, items: {{ $ref: "#/components/schemas/{n}" }} }}'
def obj(name, desc, props, required=None):
    req = required if required is not None else [k for k, _ in props]
    out = f"    {name}:\n      type: object\n"
    if desc:
        out += f'      description: "{desc}"\n'
    out += f"      required: [{', '.join(req)}]\n" if req else ""
    out += "      additionalProperties: false\n      properties:\n" + "".join(f"        {k}: {v}\n" for k, v in props)
    return out
def page(name, item):
    return obj(name, None, [("items", ARR(item)), ("nextCursor", '{ type: [string, "null"] }')])

params = """    FormRecordTypePath:
      name: recordType
      in: path
      required: true
      description: A native form (form_record_type code, ADR-0041 §1).
      schema: { $ref: "#/components/schemas/FormRecordTypeCode" }
    FormRecordIdPath:
      name: recordId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    FormAttachmentId:
      name: attachmentId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    FormDraftId:
      name: draftId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    FormRecordKindQuery:
      name: kind
      in: query
      required: false
      schema: { type: string, enum: [template, source_deliverable, extension, product] }
    FormRecordTypeQuery:
      name: recordType
      in: query
      required: false
      schema: { $ref: "#/components/schemas/FormRecordTypeCode" }
    FormDraftStatusQuery:
      name: status
      in: query
      required: false
      schema: { type: string, enum: [open, closed] }
    ExportFormatQuery:
      name: format
      in: query
      required: false
      description: csv (default; text/csv) or json (application/json). Must match the Accept header when both are sent.
      schema: { type: string, enum: [csv, json] }
    ExportLanguageQuery:
      name: lang
      in: query
      required: false
      description: Language of the header labels and choice labels (default the caller's language).
      schema: { type: string, enum: [en, ar] }
    ProcedureCodePath:
      name: procedureCode
      in: path
      required: true
      schema: { $ref: "#/components/schemas/ProcedureCode" }
    ProcedureCodeQuery:
      name: procedureCode
      in: query
      required: false
      schema: { $ref: "#/components/schemas/ProcedureCode" }
    ProcedureInstanceId:
      name: instanceId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    ProcedureStepKeyPath:
      name: stepKey
      in: path
      required: true
      schema: { type: string, pattern: '^[a-z][a-z0-9_]{1,47}$' }
    ProcedureInstanceStatusQuery:
      name: status
      in: query
      required: false
      schema: { type: string, enum: [active, completed, cancelled] }
"""
s = s.replace("\n  parameters:\n", "\n  parameters:\n" + params, 1)

FIELD_TYPES = "[text, rich_text, number, currency, percentage, date, reference, attachment, lookup, choice, calculated]"
schemas = []
schemas.append('    FormRecordTypeCode:\n      type: string\n      description: "A native form: T01-T09, T11-T16, a source deliverable, an M0149 extension record type or a product record (form_record_type, ADR-0041 §1)."\n      pattern: "^(T(0[1-9]|1[0-6])|[a-z][a-z0-9_]{1,39})$"\n')
schemas.append(f"    FormFieldType:\n      type: string\n      description: The eleven Studio field types (REQ-S06-005, ADR-0041 §3).\n      enum: {FIELD_TYPES}\n")
schemas.append(obj("FormRecordType", "A native form (ADR-0041 §1). extensionBadge is true exactly for the twelve M0149 extension record types.", [
  ("code", FRT), ("ordinal", "{ type: integer, minimum: 1 }"), ("kind", "{ type: string, enum: [template, source_deliverable, extension, product] }"),
  ("titleEn", TXT(1, 200)), ("titleAr", TXT(1, 200)), ("titleArProvisional", "{ type: boolean }"), ("sourceRef", "{ type: string }"),
  ("writePermission", '{ type: [string, "null"] }'), ("extensionBadge", "{ type: boolean }"), ("customFieldsAllowed", "{ type: boolean }"),
  ("bulkEditAllowed", "{ type: boolean }"), ("featureStatus", "{ type: string, enum: [working, planned] }")]))
schemas.append(obj("FormRecordTypeList", None, [("items", ARR("FormRecordType"))]))
schemas.append(obj("FormField", "One resolved field: a protected source column or an extension field (ADR-0041 §2-§3). settings is validated per type (packages/shared/src/forms).", [
  ("key", "{ type: string, pattern: '^[a-z][a-z0-9_]{0,39}$' }"), ("origin", "{ type: string, enum: [source, admin] }"), ("protected", "{ type: boolean }"),
  ("extension", "{ type: boolean }"), ("fieldType", FT), ("labelEn", TXT(1, 200)), ("labelAr", TXT(1, 200)), ("helpEn", NTXT(1, 2000)), ("helpAr", NTXT(1, 2000)),
  ("required", "{ type: boolean }"), ("bulkEditable", "{ type: boolean }"), ("storageKind", '{ type: [string, "null"], enum: [column, composite, computed, null] }'),
  ("sourceRef", '{ type: [string, "null"] }'), ("ordinal", '{ type: ["integer", "null"] }'), ("settings", "{ type: object }")]))
schemas.append(obj("FormSchema", "The form of one record type in one form_schema version.", [
  ("recordType", REF("FormRecordType")), ("formSchemaVersionId", U), ("versionNo", "{ type: integer, minimum: 1 }"),
  ("labelEn", TXT(1, 200)), ("labelAr", TXT(1, 200)), ("helpEn", NTXT(1, 2000)), ("helpAr", NTXT(1, 2000)), ("fields", ARR("FormField"))]))
schemas.append(obj("FormCustomValues", "Extension-field values of one record. Number and percentage values are Decimal strings (a percentage is a fraction: 12% is 0.12); currency values are {amount, currencyCode}; null is Unknown. Calculated fields are returned in calculated, never stored.", [
  ("recordType", FRT), ("recordId", U), ("formSchemaVersionId", U), ("values", "{ type: object }"),
  ("calculated", '{ type: object, additionalProperties: { type: object, additionalProperties: false, required: [status, value, missingFields], properties: { status: { type: string, enum: [computed, not_computable] }, value: { oneOf: [{ $ref: "#/components/schemas/Decimal" }, { type: "null" }] }, missingFields: { type: array, items: { type: string } } } } }'),
  ("version", "{ type: integer, minimum: 0 }"), ("updatedAt", NTS), ("updatedBy", NU)]))
schemas.append(obj("FormCustomValuesPut", "The complete set of extension-field values (absent keys are cleared).", [("values", "{ type: object, maxProperties: 200 }")]))
schemas.append(obj("FormRecordVersion", "One entry of a record's version history (from the audit trail).", [
  ("version", '{ type: ["integer", "null"], minimum: 1 }'), ("action", "{ type: string }"), ("actorUserId", NU), ("actorDisplayName", '{ type: [string, "null"] }'),
  ("occurredAt", TS), ("changedFields", "{ type: array, items: { type: string } }")]))
schemas.append(page("FormRecordVersionPage", "FormRecordVersion"))
schemas.append(obj("FormRecordComment", "A comment on a record (append-only).", [
  ("id", U), ("recordType", FRT), ("recordId", U), ("parentCommentId", NU), ("body", TXT(1, 4000)), ("createdAt", TS), ("createdBy", U), ("createdByDisplayName", '{ type: [string, "null"] }')]))
schemas.append(page("FormRecordCommentPage", "FormRecordComment"))
schemas.append(obj("FormRecordCommentCreate", None, [("body", TXT(1, 4000)), ("parentCommentId", NU)], required=["body"]))
schemas.append(obj("FormRecordAttachment", "Evidence attached to a record (DG2 evidence link or P5 attachment).", [
  ("id", U), ("store", "{ type: string, enum: [evidence_link, form_record_attachment] }"), ("recordType", FRT), ("recordId", U), ("evidenceId", U),
  ("evidenceTitle", '{ type: [string, "null"] }'), ("status", "{ type: string, enum: [active, removed] }"), ("removedAt", NTS), ("removeReason", NTXT(3, 1000)),
  ("version", VER), ("createdAt", TS), ("createdBy", U)]))
schemas.append(page("FormRecordAttachmentPage", "FormRecordAttachment"))
schemas.append(obj("FormRecordAttachmentCreate", None, [("evidenceId", U)]))
schemas.append(obj("FormRecordAttachmentRemove", None, [("reason", TXT(3, 1000))]))
schemas.append(obj("FormRecordExport", "JSON export (format=json): column keys and labels, then one row per record; values are strings or null; statuses mark Unknown and Not computable.", [
  ("recordType", FRT), ("formSchemaVersionId", U), ("language", "{ type: string, enum: [en, ar] }"),
  ("columns", '{ type: array, items: { type: object, additionalProperties: false, required: [key, label, fieldType, extension], properties: { key: { type: string }, label: { type: string }, fieldType: { $ref: "#/components/schemas/FormFieldType" }, extension: { type: boolean } } } }'),
  ("rows", '{ type: array, maxItems: 5000, items: { type: object, additionalProperties: false, required: [recordId, version, values, statuses], properties: { recordId: { $ref: "#/components/schemas/Uuid" }, version: { $ref: "#/components/schemas/Version" }, values: { type: object }, statuses: { type: object, additionalProperties: { type: string, enum: [unknown, not_computable] } } } } }')]))
schemas.append(obj("FormBulkItem", "One record of a bulk edit with the version the user saw.", [
  ("recordId", U), ("version", VER), ("sourceFields", "{ type: object, maxProperties: 20 }"), ("customFieldValues", "{ type: object, maxProperties: 200 }")], required=["recordId", "version"]))
schemas.append(obj("FormBulkUpdate", None, [("items", '{ type: array, minItems: 1, maxItems: 100, items: { $ref: "#/components/schemas/FormBulkItem" } }')]))
schemas.append(obj("FormBulkUpdateResult", "All items were saved (all-or-nothing).", [
  ("items", '{ type: array, items: { type: object, additionalProperties: false, required: [recordId, version], properties: { recordId: { $ref: "#/components/schemas/Uuid" }, version: { $ref: "#/components/schemas/Version" } } } }')]))
schemas.append(obj("FormDraft", "A saved draft (owner only).", [
  ("id", U), ("recordType", FRT), ("recordId", NU), ("baseRecordVersion", '{ type: ["integer", "null"], minimum: 1 }'), ("baseChanged", "{ type: boolean }"),
  ("payload", "{ type: object }"), ("status", "{ type: string, enum: [open, closed] }"), ("closedReason", '{ type: [string, "null"], enum: [saved, discarded, null] }'),
  ("closedAt", NTS), ("version", VER), ("createdAt", TS), ("updatedAt", TS)]))
schemas.append(page("FormDraftPage", "FormDraft"))
schemas.append(obj("FormDraftCreate", "recordId and baseRecordVersion together, or neither (a new record).", [
  ("recordType", FRT), ("recordId", NU), ("baseRecordVersion", '{ type: ["integer", "null"], minimum: 1 }'), ("payload", "{ type: object }")], required=["recordType", "payload"]))
schemas.append(obj("FormDraftUpdate", None, [("payload", "{ type: object }")]))
schemas.append(obj("FormDraftClose", None, [("reason", "{ type: string, enum: [saved, discarded] }")]))
# procedures
schemas.append('    ProcedureCode:\n      type: string\n      pattern: "^[a-z][a-z0-9_]{2,47}$"\n')
schemas.append(obj("ProcedureInputField", "One input of a procedure, using the eleven field types (ADR-0041 §3).", [
  ("key", "{ type: string, pattern: '^[a-z][a-zA-Z0-9_]{0,39}$' }"), ("fieldType", FT), ("labelEn", TXT(1, 200)), ("labelAr", TXT(1, 200)),
  ("required", "{ type: boolean }"), ("helpEn", NTXT(1, 2000)), ("helpAr", NTXT(1, 2000)), ("options", "{ type: array, maxItems: 100, items: { type: string } }"), ("settings", "{ type: object }")],
  required=["key", "fieldType", "labelEn", "labelAr", "required"]))
STEP_PROPS = [
  ("stepKey", "{ type: string, pattern: '^[a-z][a-z0-9_]{1,47}$' }"), ("ordinal", "{ type: integer, minimum: 1, maximum: 99 }"),
  ("parallelGroup", '{ type: [string, "null"], pattern: "^[a-z][a-z0-9_]{0,31}$" }'), ("stepKind", "{ type: string, enum: [task, approval] }"),
  ("nameEn", TXT(1, 200)), ("nameAr", TXT(1, 200)), ("instructionsEn", NTXT(1, 2000)), ("instructionsAr", NTXT(1, 2000)),
  ("responsibleRoleCode", RC), ("approvalRoleCode", '{ oneOf: [{ $ref: "#/components/schemas/RoleCode" }, { type: "null" }] }'),
  ("slaWorkingDays", "{ type: integer, minimum: 1, maximum: 250 }"),
  ("condition", '{ oneOf: [{ type: "null" }, { type: object, additionalProperties: false, required: [inputKey, operator], properties: { inputKey: { type: string }, operator: { type: string, enum: [eq, neq, in, gt, gte, lt, lte, present, absent] }, value: {} } }] }'),
  ("requiredInputKeys", "{ type: array, maxItems: 50, items: { type: string } }"), ("evidenceRequired", "{ type: boolean }"),
  ("output", '{ oneOf: [{ type: "null" }, { type: object, additionalProperties: false, required: [recordType, mode], properties: { recordType: { $ref: "#/components/schemas/ProcedureOutputRecordType" }, mode: { type: string, enum: [create, advance, link] } } }] }'),
  ("skippable", "{ type: boolean }")]
schemas.append('    ProcedureOutputRecordType:\n      type: string\n      enum: [transformation, charter, baseline, kpi_actual, tom_canvas_cell, approval, ranking_snapshot, gate_submission, change_request, finance_validation, decision, bau_handover, evidence]\n')
schemas.append(obj("ProcedureStepDefinition", "One step (ADR-0042 §2): ordered by ordinal; a shared ordinal with a shared parallelGroup runs in parallel; a condition makes it conditional.", STEP_PROPS + [("removed", "{ type: boolean }")]))
schemas.append(obj("ProcedureStepDefinitionInput", None, STEP_PROPS, required=["stepKey", "ordinal", "stepKind", "nameEn", "nameAr", "responsibleRoleCode", "slaWorkingDays"]))
DEF_PROPS = [
  ("nameEn", TXT(1, 200)), ("nameAr", TXT(1, 200)), ("purposeEn", TXT(1, 2000)), ("purposeAr", TXT(1, 2000)),
  ("trigger", '{ type: object, additionalProperties: false, required: [kind, descriptionEn, descriptionAr], properties: { kind: { type: string, enum: [manual, event, schedule] }, event: { type: [string, "null"], pattern: "^[a-z_]+\\\\.[a-z_.]+$" }, descriptionEn: { type: string, minLength: 1, maxLength: 1000 }, descriptionAr: { type: string, minLength: 1, maxLength: 1000 } } }'),
  ("scope", '{ type: object, additionalProperties: false, required: [level, descriptionEn, descriptionAr], properties: { level: { type: string, enum: [organization, transformation] }, descriptionEn: { type: string, minLength: 1, maxLength: 1000 }, descriptionAr: { type: string, minLength: 1, maxLength: 1000 } } }'),
  ("prerequisitesEn", NTXT(1, 2000)), ("prerequisitesAr", NTXT(1, 2000)),
  ("inputSchema", ARR("ProcedureInputField", 50)),
  ("launchRoleCodes", '{ type: array, minItems: 1, maxItems: 14, uniqueItems: true, items: { $ref: "#/components/schemas/RoleCode" } }'),
  ("responsibleRoleCodes", '{ type: array, minItems: 1, maxItems: 14, uniqueItems: true, items: { $ref: "#/components/schemas/RoleCode" } }'),
  ("slaWorkingDays", "{ type: integer, minimum: 1, maximum: 250 }"), ("validationRulesEn", TXT(1, 2000)), ("validationRulesAr", TXT(1, 2000)),
  ("approval", '{ type: object, additionalProperties: false, required: [mode, roleCodes], properties: { mode: { type: string, enum: [none, any, sequential, parallel] }, roleCodes: { type: array, maxItems: 6, uniqueItems: true, items: { $ref: "#/components/schemas/RoleCode" } } } }'),
  ("escalation", '{ oneOf: [{ type: "null" }, { type: object, additionalProperties: false, required: [roleCode, afterWorkingDays], properties: { roleCode: { $ref: "#/components/schemas/RoleCode" }, afterWorkingDays: { type: integer, minimum: 1, maximum: 250 } } }] }'),
  ("expectedOutputsEn", TXT(1, 2000)), ("expectedOutputsAr", TXT(1, 2000)),
  ("completion", '{ type: object, additionalProperties: false, required: [rule, descriptionEn, descriptionAr], properties: { rule: { type: string, enum: [all_steps_closed, all_steps_closed_and_outputs_linked] }, descriptionEn: { type: string, minLength: 1, maxLength: 1000 }, descriptionAr: { type: string, minLength: 1, maxLength: 1000 } } }'),
  ("exceptionsEn", NTXT(1, 2000)), ("exceptionsAr", NTXT(1, 2000)), ("effectiveFrom", BD), ("ordinal", "{ type: integer, minimum: 1, maximum: 999 }")]
schemas.append(obj("ProcedureDefinitionInput", "A definition with all M0152 parts. A missing trigger or completion is refused with 422 procedure_definition.trigger_required / completion_required (ADR-0042 §1).", DEF_PROPS + [("steps", '{ type: array, maxItems: 99, items: { $ref: "#/components/schemas/ProcedureStepDefinitionInput" } }')],
  required=["nameEn", "nameAr", "purposeEn", "purposeAr", "scope", "launchRoleCodes", "responsibleRoleCodes", "slaWorkingDays", "validationRulesEn", "validationRulesAr", "approval", "expectedOutputsEn", "expectedOutputsAr", "effectiveFrom", "steps"]))
schemas.append(obj("ProcedureDefinition", "A procedure definition in one procedures version (ADR-0042 §1). productDefaults marks the seeded texts as product defaults, not playbook text.", [
  ("id", U), ("code", REF("ProcedureCode")), ("methodologyVersionId", U), ("versionNo", "{ type: integer, minimum: 1 }"),
  ("versionStatus", "{ type: string, enum: [draft, published, retired] }"), ("origin", "{ type: string, enum: [source, admin] }"), ("removed", "{ type: boolean }"),
  ("productDefaults", "{ type: boolean }"), ("sourceRef", '{ type: [string, "null"] }')] + DEF_PROPS + [("steps", ARR("ProcedureStepDefinition")), ("version", VER), ("createdAt", TS), ("updatedAt", TS)]))
schemas.append(page("ProcedureDefinitionPage", "ProcedureDefinition"))
schemas.append(obj("ProcedureValidationReport", "Every finding of a definition body; valid is true when there is none.", [
  ("valid", "{ type: boolean }"),
  ("findings", '{ type: array, items: { type: object, additionalProperties: false, required: [code, pointer, message], properties: { code: { type: string }, pointer: { type: string }, message: { type: string } } } }')]))
schemas.append(obj("ProcedureLaunch", "transformationId is null exactly for an organization-scope procedure.", [
  ("procedureCode", REF("ProcedureCode")), ("transformationId", NU), ("subjectRecordType", '{ type: [string, "null"] }'), ("subjectRecordId", NU), ("inputValues", "{ type: object }")],
  required=["procedureCode", "transformationId"]))
schemas.append(obj("ProcedureInstanceLink", "A real record the instance produced (output) or used (evidence); append-only.", [
  ("id", U), ("stepKey", '{ type: [string, "null"] }'), ("linkKind", "{ type: string, enum: [output, evidence] }"), ("recordType", REF("ProcedureOutputRecordType")), ("recordId", U), ("createdAt", TS), ("createdBy", U)]))
schemas.append(obj("ProcedureStepInstance", "One step of an instance; dueDate is null (Unknown) without a business calendar.", [
  ("stepKey", "{ type: string }"), ("ordinal", "{ type: integer }"), ("parallelGroup", '{ type: [string, "null"] }'), ("stepKind", "{ type: string, enum: [task, approval] }"),
  ("nameEn", "{ type: string }"), ("nameAr", "{ type: string }"),
  ("status", "{ type: string, enum: [pending, active, completed, skipped, not_applicable, cancelled] }"),
  ("assigneeRoleCode", RC), ("assigneeUserId", NU), ("dueDate", NBD), ("dueDateUnknownReason", '{ type: [string, "null"] }'), ("overdue", '{ type: ["boolean", "null"] }'),
  ("activatedAt", NTS), ("completedAt", NTS), ("completedBy", NU), ("skipReason", NTXT(3, 2000)), ("approvalId", NU), ("missingInputs", "{ type: array, items: { type: string } }")]))
schemas.append(obj("ProcedureInstance", "A launched procedure (M0153): pinned definition version, current step, assignee, due date, missing inputs, completed evidence, outputs and next action.", [
  ("id", U), ("transformationId", NU), ("procedureCode", REF("ProcedureCode")), ("procedureDefinitionId", U), ("methodologyVersionId", U), ("versionNo", "{ type: integer, minimum: 1 }"),
  ("nameEn", "{ type: string }"), ("nameAr", "{ type: string }"), ("status", "{ type: string, enum: [active, completed, cancelled] }"),
  ("subjectRecordType", '{ type: [string, "null"] }'), ("subjectRecordId", NU), ("inputValues", "{ type: object }"), ("dueDate", NBD),
  ("currentStepKeys", "{ type: array, items: { type: string } }"),
  ("missingInputs", '{ type: array, items: { type: object, additionalProperties: false, required: [key, labelEn, labelAr], properties: { key: { type: string }, labelEn: { type: string }, labelAr: { type: string } } } }'),
  ("nextAction", '{ type: object, additionalProperties: false, required: [kind, stepKey, messageKey, messageParams], properties: { kind: { type: string, enum: [provide_input, link_evidence, complete_step, await_approval, none] }, stepKey: { type: [string, "null"] }, messageKey: { type: string }, messageParams: { type: object } } }'),
  ("steps", ARR("ProcedureStepInstance")), ("links", ARR("ProcedureInstanceLink")),
  ("launchedBy", U), ("launchedAt", TS), ("completedAt", NTS), ("cancelledAt", NTS), ("cancelReason", NTXT(3, 2000)), ("version", VER), ("updatedAt", TS)]))
schemas.append(page("ProcedureInstancePage", "ProcedureInstance"))
schemas.append(obj("ProcedureInputsUpdate", "Merged into inputValues; null clears an input.", [("inputValues", "{ type: object, minProperties: 1, maxProperties: 50 }")]))
schemas.append(obj("ProcedureStepComplete", "outputRecordId is required for link outputs; create and advance outputs are produced by the adapter.", [
  ("note", NTXT(1, 4000)), ("outputRecordId", NU), ("outputInput", "{ type: object }")], required=[]))
schemas.append(obj("ProcedureStepSkip", None, [("reason", TXT(3, 2000))]))
schemas.append(obj("ProcedureStepAssign", None, [("assigneeUserId", U)]))
schemas.append(obj("ProcedureStepEvidence", None, [("evidenceId", U)]))
schemas.append(obj("ProcedureCancel", None, [("reason", TXT(3, 2000))]))
schemas.append(obj("MyProcedureStep", None, [
  ("instanceId", U), ("transformationId", NU), ("procedureCode", REF("ProcedureCode")), ("procedureNameEn", "{ type: string }"), ("procedureNameAr", "{ type: string }"),
  ("step", REF("ProcedureStepInstance"))]))
schemas.append(page("MyProcedureStepPage", "MyProcedureStep"))
schemas.append(obj("MethodologyCoverageElement", "One counted source element and its implementing forms and procedures (REQ-S01-003).", [
  ("setCode", "{ type: string }"), ("stableKey", "{ type: string }"), ("sourceLabelEn", "{ type: string }"), ("labelAr", "{ type: string }"), ("sourceRef", "{ type: string }"),
  ("status", "{ type: string, enum: [covered, planned, not_covered] }"),
  ("links", '{ type: array, items: { type: object, additionalProperties: false, required: [targetKind, targetCode, resolved, featureStatus], properties: { targetKind: { type: string, enum: [form, procedure] }, targetCode: { type: string }, resolved: { type: boolean }, featureStatus: { type: string, enum: [working, planned] } } } }')]))
schemas.append(obj("MethodologyCoverage", "Integer totals per status; planned and not covered are never shown green.", [
  ("methodologyVersionId", U), ("proceduresVersionId", U), ("formSchemaVersionId", U),
  ("totals", '{ type: object, additionalProperties: false, required: [covered, planned, notCovered, total], properties: { covered: { type: integer, minimum: 0 }, planned: { type: integer, minimum: 0 }, notCovered: { type: integer, minimum: 0 }, total: { type: integer, minimum: 0 } } }'),
  ("elements", ARR("MethodologyCoverageElement"))]))

anchor = "\n  schemas:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + "".join(schemas), 1)
open(F, "w").write(s)
print("operations added:", sum(p.count("operationId:") for p in paths))
