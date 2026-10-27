# T-DG6-ARCH-04: appends the slice H/G operations (ADR-0057, ADR-0058) to docs/api/openapi.yaml as text, and inserts the
# optional filter and sort query parameters of ADR-0057 §5 into 11 existing list operations (D-195 seam 14: additive;
# an absent parameter returns today's result). Every other P1-P5, ARCH-01, ARCH-02 and ARCH-03 byte stays as it was
# (only the PermissionCode enum, one tag, the 11 parameter lists and appended paths/parameters/schemas change;
# info.version is already 1.5.0-p6).
# Run once from the repository root: python3 docs/delivery/handbacks/DG6/T-DG6-ARCH-04-evidence/openapi-p6-arch04.py
P = "docs/api/openapi.yaml"
s = open(P, encoding="utf-8").read()
assert "version: 1.5.0-p6\n" in s and "operationId: searchRecords" not in s

MUT = """      security:
        - sessionCookie: []
          csrfToken: []
"""


def R(code, comp):
    return f'        "{code}": {{ $ref: "#/components/responses/{comp}" }}\n'


R400, R401, R403, R404 = R(400, "ValidationError"), R(401, "Unauthenticated"), R(403, "Forbidden"), R(404, "NotFound")
R409, R422, R428, R429 = R(409, "VersionConflict"), R(422, "BusinessRule"), R(428, "PreconditionRequired"), R(429, "RateLimited")
READ = R400 + R401 + R403 + R404 + R429
LIST = R400 + R401 + R403 + R429
WRITE = R400 + R401 + R403 + R404 + R409 + R422 + R428 + R429
CREATE = R400 + R401 + R403 + R404 + R409 + R422 + R429


def problem(code, text):
    return f"""        "{code}":
          description: "{text}"
          content:
            application/problem+json:
              schema: {{ $ref: "#/components/schemas/Problem" }}
"""


def ok(schema, etag=False, status="200", desc="OK.", location=False):
    h = ""
    if etag or location:
        h = "          headers:\n"
        if location:
            h += '            Location: { $ref: "#/components/headers/Location" }\n'
        if etag:
            h += '            ETag: { $ref: "#/components/headers/ETag" }\n'
    return f"""        "{status}":
          description: "{desc}"
{h}          content:
            application/json:
              schema: {{ $ref: "#/components/schemas/{schema}" }}
"""


def body(schema, media="application/json"):
    return f"""      requestBody:
        required: true
        content:
          {media}:
            schema: {{ $ref: "#/components/schemas/{schema}" }}
"""


def op(method, tag, oid, summary, responses, params="", mutation=False, req=None):
    out = f"""    {method}:
      tags: [{tag}]
      operationId: {oid}
      summary: "{summary}"
"""
    if mutation:
        out += MUT
    if params:
        out += "      parameters:\n" + params
    if req:
        out += body(req)
    return out + "      responses:\n" + responses


IFM = '        - $ref: "#/components/parameters/IfMatch"\n'
PAGE = '        - $ref: "#/components/parameters/Cursor"\n        - $ref: "#/components/parameters/Limit"\n'
SV = '      - $ref: "#/components/parameters/SavedViewId"\n'

# ---------------------------------------------------------------------------------------------- search (ADR-0057 §1-§3)
paths = "  /api/v1/search:\n" + op(
    "get", "search", "searchRecords",
    "Global search over 12 record types (transformations, initiatives, KPIs, benefits, RAID entries, dependencies, decisions, deliverables, evidence, business cases, lessons, change requests) in English, Arabic and codes. Returns only records the caller may read: each hit passes ReadScope for the read permission of its record's own view, with sensitivity (ADR-0051), at query time. Ranked by relevance; no money or KPI value is indexed. `stale` is true when the index is behind or rebuilding. Rate-limit class `search`. 400 search.query_too_short; 503 search.index_unavailable. ADR-0057 §3; REQ-S15-010, REQ-S10-004.",
    ok("SearchResultPage") + LIST + problem(503, "search.index_unavailable: every requested record type's index failed."),
    '        - { name: q, in: query, required: true, description: "2-200 characters after trimming (shared free-text rules).", schema: { type: string, minLength: 1, maxLength: 200 } }\n'
    '        - name: recordType\n          in: query\n          required: false\n          description: Repeatable; any of the given record types (default all 12).\n          style: form\n          explode: true\n          schema: { type: array, maxItems: 12, items: { $ref: "#/components/schemas/SearchRecordType" } }\n'
    '        - { name: transformationId, in: query, required: false, description: "Only this transformation (a transformation the caller cannot read gives an empty page).", schema: { $ref: "#/components/schemas/Uuid" } }\n'
    '        - { name: includeArchived, in: query, required: false, schema: { type: boolean, default: false } }\n' + PAGE)
paths += "  /api/v1/admin/search/index:\n" + op(
    "get", "search", "getSearchIndexStatus",
    "The search index state per record type: status (idle, reindexing, failed), consumed audit sequence, last incremental run, last full reindex, document count (null = Unknown) and last error code; no record data (operations.read; ADR-0053). A reindex is started with runJobNow for job code search.reindex (job.repair). ADR-0057 §2.",
    ok("SearchIndexStatus") + LIST)

# ---------------------------------------------------------------------------------------------- saved views (ADR-0057 §4)
paths += "  /api/v1/saved-views:\n" + op(
    "get", "search", "listSavedViews",
    "The caller's active saved views of one list plus the active views shared in the caller's organization (signed in; AUD reads and applies). A shared view of a transformation the caller cannot read is not listed. Owner's views first, then shared, each by name. ADR-0057 §4; REQ-S15-013.",
    ok("SavedViewPage") + LIST,
    '        - { name: listKey, in: query, required: true, schema: { $ref: "#/components/schemas/SavedViewListKey" } }\n'
    '        - { name: transformationId, in: query, required: false, description: "Views of this transformation and views for any transformation (transformationId null).", schema: { $ref: "#/components/schemas/Uuid" } }\n' + PAGE) + op(
    "post", "search", "createSavedView",
    "Save a personal view of a list: columns, filters and sort, optionally as the default (saved_view.manage; every role except AUD). Keys are checked against the list registry. Setting isDefault clears the owner's previous default for the list. Audit saved_view.created. 404 transformation not readable; 409 saved_view.name_taken; 422 saved_view.unknown_key. ADR-0057 §4.",
    ok("SavedView", True, "201", "Created.", True) + CREATE, "", True, "SavedViewCreate")
paths += "  /api/v1/saved-views/{savedViewId}:\n    parameters:\n" + SV + op(
    "get", "search", "getSavedView",
    "One saved view: the owner's own, or any view shared in the caller's organization (others 404). ADR-0057 §4.",
    ok("SavedView", True) + READ) + op(
    "put", "search", "putSavedView",
    "Change the name, columns, filters, sort and default flag of one's own view (saved_view.manage; owner only, else 403 saved_view.not_owner). Audit saved_view.updated. 409 saved_view.name_taken, saved_view.deleted; 422 saved_view.unknown_key. ADR-0057 §4.",
    ok("SavedView", True) + WRITE, IFM, True, "SavedViewUpdate") + op(
    "delete", "search", "deleteSavedView",
    "Delete one's own view (soft: status deleted, final; saved_view.manage; owner only). Returns the deleted view. Audit saved_view.deleted. 409 saved_view.deleted. ADR-0057 §4.",
    ok("SavedView", True, "200", "Deleted.") + WRITE, IFM, True)
paths += "  /api/v1/saved-views/{savedViewId}/share:\n    parameters:\n" + SV + op(
    "post", "search", "shareSavedView",
    "Share one's own view with the organization (shared true: saved_view.share re-checked at commit; TL, BO, WL, TO, KDS, TD) or stop sharing it (shared false: owner only). A shared view grants no data. Lock 730319. Audit saved_view.shared / saved_view.unshared. ADR-0057 §4.",
    ok("SavedView", True) + WRITE, IFM, True, "SavedViewShare")

# ---------------------------------------------------------------------------------------------- drafts, compare (ADR-0057 §6, §7)
paths += "  /api/v1/me/form-drafts:\n" + op(
    "get", "forms", "listMyFormDrafts",
    "The caller's open form drafts across transformations, newest first, for draft recovery (signed in; own drafts only). Drafts in a transformation the caller can no longer read are left out and not changed. A draft is 'Draft - not submitted' and never counted in any total. ADR-0057 §6; REQ-S15-010, REQ-S15-011.",
    ok("MyFormDraftPage") + LIST, PAGE)
paths += "  /api/v1/transformations/{transformationId}/form-records/{recordType}/{recordId}/compare:\n    parameters:\n" \
    '      - $ref: "#/components/parameters/TransformationId"\n      - $ref: "#/components/parameters/FormRecordTypePath"\n      - $ref: "#/components/parameters/FormRecordIdPath"\n' + op(
    "get", "forms", "compareFormRecordVersions",
    "The fields that differ between two versions of a record, folded from the audit trail (transformation.read). Values only for a caller holding the record type's write permission or audit.read in scope; other readers get valuesWithheld true and field names only. A field without a recorded diff is recorded false (Unknown). 422 form_record.compare_versions_invalid. ADR-0057 §7; REQ-S15-010.",
    ok("FormRecordComparison") + READ + R422,
    '        - { name: fromVersion, in: query, required: true, schema: { type: integer, minimum: 1 } }\n'
    '        - { name: toVersion, in: query, required: true, schema: { type: integer, minimum: 2 } }\n')

# ---------------------------------------------------------------------------------------------- help topics (ADR-0057 §9)
paths += "  /api/v1/help-topics:\n" + op(
    "get", "search", "listHelpTopics",
    "Contextual help topics in English and Arabic (the Arabic labelled provisional), optionally for one screen, by screen and ordinal (signed in; read-only catalogue). ADR-0057 §9; REQ-S15-010.",
    ok("HelpTopicPage") + LIST,
    '        - { name: screenKey, in: query, required: false, schema: { type: string, pattern: "^[a-z][a-z0-9_]*(\\\\.[a-z0-9_]+)*$", maxLength: 80 } }\n' + PAGE)
paths += "  /api/v1/help-topics/{topicKey}:\n    parameters:\n" + '      - $ref: "#/components/parameters/HelpTopicKey"\n' + op(
    "get", "search", "getHelpTopic",
    "One help topic (signed in). ADR-0057 §9.",
    ok("HelpTopic") + READ)

params = """    SavedViewId:
      name: savedViewId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    HelpTopicKey:
      name: topicKey
      in: path
      required: true
      schema: { type: string, pattern: "^[a-z][a-z0-9_]*(\\\\.[a-z0-9_]+)*$", maxLength: 80 }
    RegisterQuery:
      name: q
      in: query
      required: false
      description: "Case-insensitive substring over the list's declared text columns (ADR-0057 §5). Absent: no text filter."
      schema: { type: string, minLength: 1, maxLength: 200 }
    RegisterSort:
      name: sort
      in: query
      required: false
      description: "A sort key the list declares, optionally prefixed '-' for descending (ADR-0057 §5); an unknown key is 400 at /query/sort. Absent: today's order."
      schema: { type: string, pattern: "^-?[a-z][A-Za-z]{0,39}$" }
"""

schemas = """    SearchRecordType:
      type: string
      enum: [transformation, initiative, kpi_definition, benefit, raid_entry, dependency, decision, deliverable, evidence, business_case, lesson, change_request]
    SearchHit:
      type: object
      required: [recordType, recordId, recordVersion, transformationId, transformationCode, transformationName, code, title, summary, recordStatus, isArchived]
      additionalProperties: false
      properties:
        recordType: { $ref: "#/components/schemas/SearchRecordType" }
        recordId: { $ref: "#/components/schemas/Uuid" }
        recordVersion: { type: integer, minimum: 1 }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        transformationCode: { type: string }
        transformationName: { type: string }
        code: { type: [string, "null"], maxLength: 40 }
        title: { type: string, minLength: 1, maxLength: 500 }
        summary: { type: [string, "null"], maxLength: 1000, description: "Plain text, no markup." }
        recordStatus: { type: [string, "null"] }
        isArchived: { type: boolean }
    SearchResultPage:
      type: object
      required: [items, nextCursor, indexedThrough, stale]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/SearchHit" } }
        nextCursor: { type: [string, "null"] }
        indexedThrough: { $ref: "#/components/schemas/NullableTimestamp" }
        stale: { type: boolean, description: "true when a requested type is reindexing or failed, or the index is more than 120 s behind (ADR-0057 §2)." }
    SearchIndexStatus:
      type: object
      required: [types]
      additionalProperties: false
      properties:
        types:
          type: array
          items:
            type: object
            required: [recordType, status, lastAuditSeq, lastIncrementalAt, reindexStartedAt, reindexFinishedAt, documentsCount, lastErrorCode, lastErrorAt, version]
            additionalProperties: false
            properties:
              recordType: { $ref: "#/components/schemas/SearchRecordType" }
              status: { type: string, enum: [idle, reindexing, failed] }
              lastAuditSeq: { type: string, pattern: "^[0-9]{1,19}$", description: "A bigint as a decimal string." }
              lastIncrementalAt: { $ref: "#/components/schemas/NullableTimestamp" }
              reindexStartedAt: { $ref: "#/components/schemas/NullableTimestamp" }
              reindexFinishedAt: { $ref: "#/components/schemas/NullableTimestamp" }
              documentsCount: { type: [integer, "null"], minimum: 0, description: "null = Unknown (never 0 by default)." }
              lastErrorCode: { type: [string, "null"] }
              lastErrorAt: { $ref: "#/components/schemas/NullableTimestamp" }
              version: { type: integer, minimum: 1 }
    SavedViewListKey:
      type: string
      enum: [transformations, initiatives, strategic_guardrails, outcomes, diagnostic_items, diagnostic_findings, workstream_outputs, tom_gaps, capability_heatmap, journeys, journey_pain_points, search]
    SavedViewColumns:
      type: array
      minItems: 1
      maxItems: 50
      uniqueItems: true
      items: { type: string, pattern: "^[a-z][A-Za-z0-9]{0,63}$" }
    SavedViewFilters:
      type: object
      maxProperties: 20
      description: "Filter key -> a string (1-200) or 1-20 strings; decimals and dates travel as strings (ADR-0057 §4, §11)."
      propertyNames: { pattern: "^[a-z][A-Za-z0-9]{0,63}$" }
      additionalProperties:
        oneOf:
          - { type: string, minLength: 1, maxLength: 200 }
          - { type: array, minItems: 1, maxItems: 20, items: { type: string, minLength: 1, maxLength: 200 } }
    SavedViewSort:
      type: array
      maxItems: 3
      items:
        type: object
        required: [key, direction]
        additionalProperties: false
        properties:
          key: { type: string, pattern: "^[a-z][A-Za-z0-9]{0,63}$" }
          direction: { type: string, enum: [asc, desc] }
    SavedView:
      type: object
      required: [id, organizationId, ownerUserId, ownerDisplayName, isOwner, listKey, transformationId, name, visibility, columns, filters, sort, isDefault, sharedAt, sharedBy, status, deletedAt, version, createdAt, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        organizationId: { $ref: "#/components/schemas/Uuid" }
        ownerUserId: { $ref: "#/components/schemas/Uuid" }
        ownerDisplayName: { type: string }
        isOwner: { type: boolean }
        listKey: { $ref: "#/components/schemas/SavedViewListKey" }
        transformationId: { $ref: "#/components/schemas/NullableUuid" }
        name: { type: string, minLength: 1, maxLength: 120 }
        visibility: { type: string, enum: [personal, shared] }
        columns: { $ref: "#/components/schemas/SavedViewColumns" }
        filters: { $ref: "#/components/schemas/SavedViewFilters" }
        sort: { $ref: "#/components/schemas/SavedViewSort" }
        isDefault: { type: boolean }
        sharedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        sharedBy: { $ref: "#/components/schemas/NullableUuid" }
        status: { type: string, enum: [active, deleted] }
        deletedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        version: { type: integer, minimum: 1 }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    SavedViewPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/SavedView" } }
        nextCursor: { type: [string, "null"] }
    SavedViewCreate:
      type: object
      required: [listKey, name, columns]
      additionalProperties: false
      properties:
        listKey: { $ref: "#/components/schemas/SavedViewListKey" }
        transformationId: { $ref: "#/components/schemas/NullableUuid" }
        name: { type: string, minLength: 1, maxLength: 120 }
        columns: { $ref: "#/components/schemas/SavedViewColumns" }
        filters: { $ref: "#/components/schemas/SavedViewFilters" }
        sort: { $ref: "#/components/schemas/SavedViewSort" }
        isDefault: { type: boolean, default: false }
    SavedViewUpdate:
      type: object
      required: [name, columns, filters, sort, isDefault]
      additionalProperties: false
      properties:
        name: { type: string, minLength: 1, maxLength: 120 }
        columns: { $ref: "#/components/schemas/SavedViewColumns" }
        filters: { $ref: "#/components/schemas/SavedViewFilters" }
        sort: { $ref: "#/components/schemas/SavedViewSort" }
        isDefault: { type: boolean }
    SavedViewShare:
      type: object
      required: [shared]
      additionalProperties: false
      properties:
        shared: { type: boolean }
    MyFormDraft:
      type: object
      required: [id, transformationId, transformationCode, transformationName, recordType, recordId, baseRecordVersion, baseChanged, version, createdAt, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        transformationCode: { type: string }
        transformationName: { type: string }
        recordType: { $ref: "#/components/schemas/FormRecordTypeCode" }
        recordId: { $ref: "#/components/schemas/NullableUuid" }
        baseRecordVersion: { type: ["integer", "null"], minimum: 1 }
        baseChanged: { type: boolean }
        version: { type: integer, minimum: 1 }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    MyFormDraftPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/MyFormDraft" } }
        nextCursor: { type: [string, "null"] }
    FormRecordComparison:
      type: object
      required: [transformationId, recordType, recordId, fromVersion, toVersion, currentVersion, valuesWithheld, fields]
      additionalProperties: false
      properties:
        transformationId: { $ref: "#/components/schemas/Uuid" }
        recordType: { $ref: "#/components/schemas/FormRecordTypeCode" }
        recordId: { $ref: "#/components/schemas/Uuid" }
        fromVersion: { type: integer, minimum: 1 }
        toVersion: { type: integer, minimum: 2 }
        currentVersion: { type: integer, minimum: 1 }
        valuesWithheld: { type: boolean, description: "true: the caller holds neither the record type's write permission nor audit.read; no from/to values are returned." }
        fields:
          type: array
          items:
            type: object
            required: [fieldKey, labelEn, labelAr, recorded]
            additionalProperties: false
            properties:
              fieldKey: { type: string }
              labelEn: { type: string }
              labelAr: { type: string }
              recorded: { type: boolean, description: "false: a write changed the record without a recorded diff for this field (Unknown)." }
              from: { type: [string, number, boolean, array, object, "null"], description: "Absent when valuesWithheld or not recorded. Decimals are strings." }
              to: { type: [string, number, boolean, array, object, "null"], description: "Absent when valuesWithheld or not recorded. Decimals are strings." }
    HelpTopic:
      type: object
      required: [topicKey, screenKey, ordinal, titleEn, titleAr, bodyEn, bodyAr, arabicProvisional, sourceRefs]
      additionalProperties: false
      properties:
        topicKey: { type: string }
        screenKey: { type: string }
        ordinal: { type: integer, minimum: 1 }
        titleEn: { type: string }
        titleAr: { type: string }
        bodyEn: { type: string }
        bodyAr: { type: string }
        arabicProvisional: { type: boolean }
        sourceRefs: { type: array, minItems: 1, items: { type: string, pattern: "^(M0[0-9]{3}|B0[0-9]{3}|REQ-S[0-9]{2}-[0-9]{3})$" } }
    HelpTopicPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/HelpTopic" } }
        nextCursor: { type: [string, "null"] }
"""

tag = """  - name: search
    description: Global scoped search, saved views and contextual help (P6, ADR-0057).
"""

# ---- the optional list parameters (ADR-0057 §5), inserted before each operation's Cursor parameter
CURSOR = '        - $ref: "#/components/parameters/Cursor"\n'
RQ = '        - $ref: "#/components/parameters/RegisterQuery"\n'
RS = '        - $ref: "#/components/parameters/RegisterSort"\n'
INSERTS = {
    "listInitiatives": RQ
    + '        - { name: executiveOwnerUserId, in: query, required: false, schema: { $ref: "#/components/schemas/Uuid" } }\n'
    + '        - { name: workstreamLeadUserId, in: query, required: false, schema: { $ref: "#/components/schemas/Uuid" } }\n'
    + '        - { name: sort, in: query, required: false, description: "Absent: -updatedAt (today\'s order). Keyset (sort value, id); nulls last ascending (ADR-0057 §5).", schema: { type: string, enum: [-updatedAt, updatedAt, code, -code, name, -name, plannedEnd, -plannedEnd] } }\n',
    "listTransformations": '        - { name: sort, in: query, required: false, description: "Absent: today\'s order (ADR-0057 §5).", schema: { type: string, enum: [-updatedAt, updatedAt, code, -code] } }\n',
}
for oid in ["listStrategicGuardrails", "listOutcomes", "listDiagnosticItems", "listDiagnosticFindings", "listWorkstreamOutputs",
            "listTomGaps", "listCapabilityHeatmapEntries", "listJourneies", "listJourneyPainPoints"]:
    INSERTS[oid] = RQ + RS
for oid, ins in INSERTS.items():
    marker = f"      operationId: {oid}\n"
    assert s.count(marker) == 1, oid
    i = s.index(marker)
    j = s.index(CURSOR, i)
    # the Cursor parameter must belong to this operation (before the next operationId)
    nxt = s.find("      operationId: ", i + len(marker))
    assert nxt == -1 or j < nxt, oid
    s = s[:j] + ins + s[j:]

_perm_tail = "        - external_change.confirm\n    RoleCode:"
assert s.count(_perm_tail) == 1
s = s.replace(_perm_tail, "        - external_change.confirm\n        - saved_view.manage\n        - saved_view.share\n    RoleCode:", 1)
_tag_anchor = "  - name: integrations\n"
assert s.count(_tag_anchor) == 1
s = s.replace(_tag_anchor, tag + _tag_anchor, 1)
assert s.count("\ncomponents:\n") == 1
s = s.replace("\ncomponents:\n", "\n" + paths + "components:\n", 1)
assert s.count("\n  headers:\n") == 1
s = s.replace("\n  headers:\n", "\n" + params + "  headers:\n", 1)
if not s.endswith("\n"):
    s += "\n"
s += schemas
open(P, "w", encoding="utf-8").write(s)
print("operations:", s.count("operationId:"))
