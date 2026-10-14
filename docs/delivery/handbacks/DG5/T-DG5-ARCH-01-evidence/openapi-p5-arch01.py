# T-DG5-ARCH-01: appends the slice A operations (ADR-0039, ADR-0040) to docs/api/openapi.yaml and sets info.version to
# 1.4.0-p5. Every P1-P4 path stays byte-stable. The existing IncludeRemovedQuery parameter (boolean, default false) is reused. Run once from the repository root (refuses to run twice).
import re
F = "docs/api/openapi.yaml"
s = open(F).read()
assert "/api/v1/admin/methodology-versions:" not in s, "already applied"
assert s.count("\n  version: 1.3.0-p4\n") == 1
s = s.replace("\n  version: 1.3.0-p4\n", "\n  version: 1.4.0-p5\n", 1)

R = lambda name: f'{{ $ref: "#/components/responses/{name}" }}'
def resp(codes):
    m = {400: "ValidationError", 401: "Unauthenticated", 403: "Forbidden", 404: "NotFound", 409: "VersionConflict",
         422: "BusinessRule", 428: "PreconditionRequired", 429: "RateLimited"}
    return "".join(f'        "{c}": {R(m[c] if not isinstance(c, tuple) else c[1])}\n' if not isinstance(c, tuple) else f'        "{c[0]}": {R(c[1])}\n' for c in codes)

def op(method, tag, opid, summary, *, params=(), body=None, ok=200, okdesc="OK.", schema=None, etag=False, created=False,
       ifmatch=False, codes=(400, 401, 403, 404, 422, 429), write=True):
    out = f"    {method}:\n      tags: [{tag}]\n      operationId: {opid}\n      summary: {summary!r}\n".replace("summary: '", 'summary: "').replace("'\n", '"\n')
    if write:
        out += "      security:\n        - sessionCookie: []\n          csrfToken: []\n"
    ps = list(params) + (["IfMatch"] if ifmatch else [])
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
    out += f'          content:\n            application/json:\n              schema: {{ $ref: "#/components/schemas/{schema}" }}\n'
    cs = list(codes)
    if ifmatch:
        cs = sorted(set([c for c in cs] + [409, 428]), key=lambda c: c if isinstance(c, int) else c[0])
    out += resp(cs)
    return out

def path(p, params, *ops):
    out = f"  {p}:\n"
    if params:
        out += "    parameters:\n" + "".join(f'      - $ref: "#/components/parameters/{x}"\n' for x in params)
    return out + "".join(ops)

V = "/api/v1/admin/methodology-versions"
VID = ["ConfigVersionId"]
T = "/api/v1/transformations/{transformationId}"
paths = []
paths.append(path(V, [],
  op("get", "studio", "listConfigVersions", "Studio configuration versions, newest first, filtered by kind and status (methodology.read; ADM_METHOD, TO, TL, SP, AUD).", params=["Cursor", "Limit", "ConfigKindQuery", "ConfigVersionStatusQuery"], schema="ConfigVersionPage", write=False, codes=(400, 401, 403, 429)),
  op("post", "studio", "createConfigDraft", "Create a draft from a published version of the same kind and key; it copies the base's element rows (methodology.configure; ADM_METHOD). 409 config_version.draft_exists; 422 config_version.unknown_element (base not published).", body="ConfigDraftCreate", ok=201, okdesc="Created (draft, editing).", schema="ConfigVersion", etag=True, created=True, codes=(400, 401, 403, 404, ("409", "Duplicate"), 422, 429))))
paths.append(path(V + "/{versionId}", VID,
  op("get", "studio", "getConfigVersion", "One configuration version with its stage, lineage, latest check runs and review state (methodology.read).", schema="ConfigVersion", etag=True, write=False, codes=(400, 401, 403, 404, 429)),
  op("patch", "studio", "updateConfigDraft", "Edit the title, change summary or definition of a draft being edited; a change in preview returns it to editing (methodology.configure). 409 config_version.not_editable.", body="ConfigDraftUpdate", schema="ConfigVersion", etag=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/elements", VID,
  op("get", "studio", "listConfigElements", "The resolved elements of a version (catalogue values, overridden by the version's rows), filtered by element type (methodology.read).", params=["Cursor", "Limit", "ElementTypeQuery", "IncludeRemovedQuery"], schema="ConfigElementPage", write=False, codes=(400, 401, 403, 404, 429))))
paths.append(path(V + "/{versionId}/elements/{elementType}/{stableKey}", VID + ["ElementType", "StableKey"],
  op("put", "studio", "putConfigElement", "Set the attributes of one element in a draft being edited; If-Match is the draft's version (methodology.configure). 409 config_version.not_editable; 422 config_version.source_element_protected, unknown_element, admin_approver_forbidden, approver_not_allowed, stable_id_change.", body="ConfigElementPut", schema="ConfigVersion", etag=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/elements/{elementType}/{stableKey}/remove", VID + ["ElementType", "StableKey"],
  op("post", "studio", "removeConfigElement", "Mark an element removed in a draft; phases, gates and TOM dimensions are refused, other source elements are recorded and fail the source-coverage check (methodology.configure). 422 config_version.source_element_protected.", schema="ConfigVersion", etag=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/diff", VID,
  op("get", "studio", "getConfigVersionDiff", "Side-by-side diff of this version against another version of the same kind and key (default: its base): added, removed and changed elements with field-level from/to (methodology.read).", params=["AgainstVersionQuery"], schema="ConfigVersionDiff", write=False, codes=(400, 401, 403, 404, 422, 429))))
paths.append(path(V + "/{versionId}/affected-records", VID,
  op("get", "studio", "getConfigAffectedRecords", "Per pinned transformation of the base lineage, the counts of records the draft's changes touch; Unknown when not countable (methodology.read).", schema="ConfigAffectedRecords", write=False, codes=(400, 401, 403, 404, 429))))
paths.append(path(V + "/{versionId}/check-runs", VID,
  op("get", "studio", "listConfigCheckRuns", "Preview, compatibility, source-coverage and invariant runs of a version, newest first (methodology.read).", params=["Cursor", "Limit", "CheckKindQuery"], schema="ConfigCheckRunPage", write=False, codes=(400, 401, 403, 404, 429))))
paths.append(path(V + "/{versionId}/compatibility-checks", VID,
  op("post", "studio", "runConfigCompatibilityCheck", "Run the compatibility check of the draft's current content and record it (methodology.publish; ADM_METHOD). pass and warn are publishable; fail is not.", ok=201, okdesc="Created (check run).", schema="ConfigCheckRun", created=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/preview", VID,
  op("post", "studio", "runConfigPreview", "Preview/test the draft in a sandbox with sample inputs (read-only transaction, rolled back); records the run, and on pass moves the stage editing -> preview (methodology.publish).", body="ConfigPreviewRequest", ok=201, okdesc="Created (check run).", schema="ConfigCheckRun", created=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/submit-review", VID,
  op("post", "studio", "submitConfigReview", "Submit the previewed draft for the configured review: records the review request, the revision proposal (validation, impact) and the reviewer tasks (methodology.publish). 422 config_version.preview_required.", body="ConfigReviewSubmit", ok=201, okdesc="Created (review request).", schema="ConfigReviewRequest", created=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/reviews", VID,
  op("get", "studio", "listConfigReviews", "Review requests of a version, newest first (methodology.read).", params=["Cursor", "Limit"], schema="ConfigReviewRequestPage", write=False, codes=(400, 401, 403, 404, 429))))
paths.append(path(V + "/{versionId}/reviews/{reviewId}/decision", VID + ["ConfigReviewId"],
  op("post", "studio", "decideConfigReview", "Approve the reviewed content or request changes with a note; never the author or the requester (methodology.review; TO). 403 config_review.self_review. If-Match is the review request's version.", body="ConfigReviewDecision", schema="ConfigReviewRequest", etag=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/reviews/{reviewId}/withdraw", VID + ["ConfigReviewId"],
  op("post", "studio", "withdrawConfigReview", "Withdraw a pending review; the draft returns to editing (methodology.publish).", schema="ConfigReviewRequest", etag=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/publish", VID,
  op("post", "studio", "publishConfigVersion", "Publish an approved draft (or a previewed draft of a kind without required review); the version becomes immutable (methodology.publish). 422 config_version.preview_required, review_required, checks_required, compatibility_failed, source_incomplete, weights_total.", schema="ConfigVersion", etag=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/rollback", VID,
  op("post", "studio", "rollbackConfigVersion", "Restore an earlier published version as a new draft (origin rollback, reason required) that follows the publish pipeline; nothing is erased (methodology.publish). If-Match is the restored version's version. 409 config_version.draft_exists; 422 config_version.rollback_target_invalid.", body="ConfigRollbackRequest", ok=201, okdesc="Created (rollback draft).", schema="ConfigVersion", etag=True, created=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/discard", VID,
  op("post", "studio", "discardConfigDraft", "Discard a draft; it stays readable (methodology.configure).", schema="ConfigVersion", etag=True, ifmatch=True)))
paths.append(path(V + "/{versionId}/scoring-defaults", VID,
  op("put", "studio", "putScoringDefaultsDraft", "Set the T06 default weights (decimal strings) and the 1-5 rubric descriptors of a scoring_defaults draft; the 100% rule is applied at publish (methodology.configure). 400 validation.weight_percent.", body="ScoringDefaultsPut", schema="ScoringDefaults", etag=True, ifmatch=True)))
paths.append(path("/api/v1/admin/scoring-defaults", [],
  op("get", "studio", "getScoringDefaults", "The newest published T06 default weights and rubric, or a given version (methodology.read).", params=["ConfigVersionIdQuery"], schema="ScoringDefaults", write=False, codes=(400, 401, 403, 404, 429))))
paths.append(path("/api/v1/admin/config-review-policies", [],
  op("get", "studio", "listConfigReviewPolicies", "Whether each configuration kind needs a review before publish, and the reviewer role (methodology.read).", schema="ConfigReviewPolicyList", write=False, codes=(400, 401, 403, 429))))
paths.append(path("/api/v1/admin/config-review-policies/{configKind}", ["ConfigKindPath"],
  op("patch", "studio", "updateConfigReviewPolicy", "Change a kind's review requirement or reviewer role (config_review_policy.configure; TO). 422 config_review.reviewer_not_allowed.", body="ConfigReviewPolicyUpdate", schema="ConfigReviewPolicy", etag=True, ifmatch=True)))
paths.append(path("/api/v1/admin/revision-proposals", [],
  op("get", "studio", "listRevisionProposals", "S12-018 records: validation, impact (affected transformations, records, benefits) and review routing of proposed methodology and formula revisions (methodology.read).", params=["Cursor", "Limit", "RevisionSubjectTypeQuery", "RevisionSubjectIdQuery"], schema="RevisionProposalPage", write=False, codes=(400, 401, 403, 429))))
paths.append(path("/api/v1/admin/source-coverage", [],
  op("get", "studio", "getSourceCoverage", "Source-completeness report of a methodology version (default: the newest published): expected and present counts per element set, removed elements and elements whose feature is planned (methodology.read).", params=["ConfigVersionIdQuery"], schema="SourceCoverageReport", write=False, codes=(400, 401, 403, 404, 429))))
paths.append(path("/api/v1/admin/source-coverage/runs", [],
  op("post", "studio", "runSourceCoverageCheck", "Run and record the source-completeness check of a draft's current content: fail when a set's count differs, warn when a feature is planned, else pass (source_coverage.run; ADM_METHOD).", body="SourceCoverageRunRequest", ok=201, okdesc="Created (check run).", schema="ConfigCheckRun", created=True, codes=(400, 401, 403, 404, ("409", "VersionConflict"), 422, 429))))
paths.append(path(T + "/config-pins", ["TransformationId"],
  op("get", "config-pins", "listTransformationConfigPins", "The configuration version the transformation is pinned to, per kind; a kind without a pin resolves to version 1 of its default key (methodology.read; SP, TL, TO, AUD, ADM_METHOD).", schema="ConfigPinList", write=False, codes=(400, 401, 403, 404, 429))))
paths.append(path(T + "/config-pins/history", ["TransformationId"],
  op("get", "config-pins", "listConfigPinHistory", "Every move of a pin, with its migration (methodology.read).", params=["Cursor", "Limit"], schema="ConfigPinHistoryPage", write=False, codes=(400, 401, 403, 404, 429))))
paths.append(path(T + "/scoring-defaults", ["TransformationId"],
  op("get", "config-pins", "getTransformationScoringDefaults", "The T06 default weights and rubric version the transformation uses (its scoring_defaults pin, else version 1) (transformation.read).", schema="ScoringDefaults", write=False, codes=(400, 401, 404, 429))))
paths.append(path(T + "/gate-reapprovals", ["TransformationId"],
  op("get", "methodology-migrations", "listGateReapprovals", "Gates that need a business re-approval after a methodology migration, with the preserved approved decision (transformation.read).", params=["Cursor", "Limit"], schema="GateReapprovalPage", write=False, codes=(400, 401, 404, 429))))
M = T + "/methodology-migrations"
MID = ["TransformationId", "MethodologyMigrationId"]
paths.append(path(M, ["TransformationId"],
  op("get", "methodology-migrations", "listMethodologyMigrations", "Methodology migrations of the transformation, newest first (methodology.read).", params=["Cursor", "Limit"], schema="MethodologyMigrationPage", write=False, codes=(400, 401, 403, 404, 429)),
  op("post", "methodology-migrations", "createMethodologyMigration", "Plan the migration of a pinned transformation to a newer published version; generates plan revision 1 (methodology_migration.plan; ADM_METHOD). 409 methodology_migration.open_exists; 422 methodology_migration.target_invalid.", body="MethodologyMigrationCreate", ok=201, okdesc="Created (draft with plan).", schema="MethodologyMigration", etag=True, created=True, codes=(400, 401, 403, 404, ("409", "Duplicate"), 422, 429))))
paths.append(path(M + "/{migrationId}", MID,
  op("get", "methodology-migrations", "getMethodologyMigration", "One migration with the items of its latest plan revision (mappings, new required fields, invalidated calculations, re-approvals) (methodology.read).", schema="MethodologyMigration", etag=True, write=False, codes=(400, 401, 403, 404, 429))))
paths.append(path(M + "/{migrationId}/preview", MID,
  op("post", "methodology-migrations", "previewMethodologyMigration", "Regenerate the plan with the admin's inputs for new required fields; appends a new plan revision (methodology_migration.plan). 422 methodology_migration.not_open.", body="MethodologyMigrationPreviewRequest", schema="MethodologyMigration", etag=True, ifmatch=True)))
paths.append(path(M + "/{migrationId}/submit", MID,
  op("post", "methodology-migrations", "submitMethodologyMigration", "Submit a ready plan and request the business approval (type methodology_migration; routed to the Sponsor (SP) by default) (methodology_migration.plan). 422 methodology_migration.inputs_required, not_open.", schema="MethodologyMigration", etag=True, ifmatch=True)))
paths.append(path(M + "/{migrationId}/decision", MID,
  op("post", "methodology-migrations", "decideMethodologyMigration", "Business approval of the migration: approve, reject or request changes with a rationale; never the requester (methodology_migration.approve; SP). 403 methodology_migration.self_approval; 422 methodology_migration.not_open.", body="MethodologyMigrationDecision", schema="MethodologyMigration", etag=True, ifmatch=True)))
paths.append(path(M + "/{migrationId}/execute", MID,
  op("post", "methodology-migrations", "executeMethodologyMigration", "Execute an approved migration: move the pin, append its history, create the gate re-approvals and their tasks; no historical record is rewritten (methodology_migration.execute; ADM_METHOD). 409 methodology_migration.pin_moved; 422 methodology_migration.not_approved.", schema="MethodologyMigration", etag=True, ifmatch=True)))
paths.append(path(M + "/{migrationId}/withdraw", MID,
  op("post", "methodology-migrations", "withdrawMethodologyMigration", "Withdraw a migration that is not executed; its approval is withdrawn too (methodology_migration.plan). 422 methodology_migration.not_open.", schema="MethodologyMigration", etag=True, ifmatch=True)))

# The PermissionCode enum (getMe, listRoles) gains the eight P5_STUDIO_PERMISSIONS codes, appended after the last P4
# code as every P2-P4 architecture task did; no existing value changes (a schema extension, not a path change).
old_enum = "        - dashboard.configure\n    RoleCode:\n"
assert s.count(old_enum) == 1
s = s.replace(old_enum, "        - dashboard.configure\n" + "".join(f"        - {c}\n" for c in [
    "methodology.read", "methodology.publish", "methodology.review", "config_review_policy.configure",
    "source_coverage.run", "methodology_migration.plan", "methodology_migration.approve",
    "methodology_migration.execute"]) + "    RoleCode:\n", 1)

anchor = "\ncomponents:\n"
assert s.count(anchor) == 1
s = s.replace(anchor, "\n" + "".join(paths) + "components:\n", 1)

tags = """  - name: studio
    description: Playbook Studio configuration versions, drafts, preview/test, review where configured, publish, diff, compatibility, source coverage, rollback and scoring defaults (P5, ADR-0039).
  - name: config-pins
    description: The configuration versions a transformation is pinned to, and their history (P5, ADR-0039, ADR-0040).
  - name: methodology-migrations
    description: Deliberate, approved migration of a pinned transformation to a newer version, with its plan and gate re-approvals; history is never rewritten (P5, ADR-0040).
"""
s = s.replace("\nsecurity:\n  - sessionCookie: []\npaths:\n", "\n" + tags + "security:\n  - sessionCookie: []\npaths:\n", 1)

KINDS = "[methodology, scoring_defaults, form_schema, procedure, automation_rule_set, health_check_scheme]"
ETYPES = "[methodology_text, phase, gate, gate_criterion, mandatory_artifact, checklist_item, template, tom_dimension, approver_route, reminder, escalation_rule, dashboard, report_layout, source_element, scoring_weight, scoring_rubric]"
params = f"""    ConfigVersionId:
      name: versionId
      in: path
      required: true
      schema: {{ $ref: "#/components/schemas/Uuid" }}
    ConfigReviewId:
      name: reviewId
      in: path
      required: true
      schema: {{ $ref: "#/components/schemas/Uuid" }}
    MethodologyMigrationId:
      name: migrationId
      in: path
      required: true
      schema: {{ $ref: "#/components/schemas/Uuid" }}
    ElementType:
      name: elementType
      in: path
      required: true
      schema: {{ $ref: "#/components/schemas/ConfigElementType" }}
    StableKey:
      name: stableKey
      in: path
      required: true
      schema: {{ type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{{0,95}}$' }}
    ConfigKindPath:
      name: configKind
      in: path
      required: true
      schema: {{ type: string, enum: [methodology, scoring_defaults, form_schema, procedure, automation_rule_set, health_check_scheme, benefit_formula] }}
    ConfigKindQuery:
      name: kind
      in: query
      required: false
      schema: {{ $ref: "#/components/schemas/ConfigKind" }}
    ConfigVersionStatusQuery:
      name: status
      in: query
      required: false
      schema: {{ type: string, enum: [draft, published, retired] }}
    ElementTypeQuery:
      name: elementType
      in: query
      required: false
      schema: {{ $ref: "#/components/schemas/ConfigElementType" }}
    AgainstVersionQuery:
      name: against
      in: query
      required: false
      description: The version to compare with (same kind and key); default the version's base.
      schema: {{ $ref: "#/components/schemas/Uuid" }}
    CheckKindQuery:
      name: checkKind
      in: query
      required: false
      schema: {{ type: string, enum: [preview, compatibility, source_coverage, invariants] }}
    ConfigVersionIdQuery:
      name: versionId
      in: query
      required: false
      schema: {{ $ref: "#/components/schemas/Uuid" }}
    RevisionSubjectTypeQuery:
      name: subjectType
      in: query
      required: false
      schema: {{ type: string, enum: [methodology_version, benefit_formula_version] }}
    RevisionSubjectIdQuery:
      name: subjectId
      in: query
      required: false
      schema: {{ $ref: "#/components/schemas/Uuid" }}
"""
s = s.replace("\n  parameters:\n", "\n  parameters:\n" + params, 1)

U = '{ $ref: "#/components/schemas/Uuid" }'
NU = '{ $ref: "#/components/schemas/NullableUuid" }'
TS = '{ $ref: "#/components/schemas/Timestamp" }'
NTS = '{ $ref: "#/components/schemas/NullableTimestamp" }'
VER = '{ $ref: "#/components/schemas/Version" }'
SHA = "{ type: string, pattern: '^[0-9a-f]{64}$' }"
def obj(name, desc, props, required=None):
    req = required if required is not None else [k for k, _ in props]
    out = f"    {name}:\n      type: object\n"
    if desc:
        out += f"      description: {desc!r}\n".replace("description: '", 'description: "').replace("'\n", '"\n')
    out += f"      required: [{', '.join(req)}]\n" if req else ""
    out += "      additionalProperties: false\n      properties:\n" + "".join(f"        {k}: {v}\n" for k, v in props)
    return out
def page(name, item):
    return obj(name, None, [("items", f'{{ type: array, items: {{ $ref: "#/components/schemas/{item}" }} }}'), ("nextCursor", '{ type: [string, "null"] }')])
TXT = lambda lo, hi: f"{{ type: string, minLength: {lo}, maxLength: {hi} }}"
NTXT = lambda lo, hi: f'{{ type: [string, "null"], minLength: {lo}, maxLength: {hi} }}'
schemas = []
schemas.append(f"    ConfigKind:\n      type: string\n      enum: {KINDS}\n")
schemas.append(f"    ConfigElementType:\n      type: string\n      enum: {ETYPES}\n")
schemas.append(obj("ConfigCheckSummary", "The latest run of one check kind for the version's current content hash; null when none.", [
  ("checkRunId", U), ("result", "{ type: string, enum: [pass, warn, fail] }"), ("createdAt", TS)]))
schemas.append(obj("ConfigVersion", "A Studio configuration version (ADR-0039 §1). Published versions are immutable.", [
  ("id", U), ("configKind", '{ $ref: "#/components/schemas/ConfigKind" }'), ("key", "{ type: string }"), ("versionNo", "{ type: integer, minimum: 1 }"),
  ("status", "{ type: string, enum: [draft, published, retired] }"),
  ("draftStage", '{ type: [string, "null"], enum: [editing, preview, review, approved, discarded, null] }'),
  ("origin", "{ type: string, enum: [seed, draft, rollback] }"), ("basedOnVersionId", NU), ("rollbackOfVersionId", NU),
  ("titleEn", TXT(1, 200)), ("titleAr", TXT(1, 200)), ("changeSummary", NTXT(1, 4000)), ("definition", "{ type: object }"),
  ("contentSha256", SHA), ("isNewestPublished", "{ type: boolean }"),
  ("latestChecks", '{ type: object, additionalProperties: false, required: [preview, compatibility, sourceCoverage], properties: { preview: { oneOf: [{ $ref: "#/components/schemas/ConfigCheckSummary" }, { type: "null" }] }, compatibility: { oneOf: [{ $ref: "#/components/schemas/ConfigCheckSummary" }, { type: "null" }] }, sourceCoverage: { oneOf: [{ $ref: "#/components/schemas/ConfigCheckSummary" }, { type: "null" }] } } }'),
  ("pendingReviewId", NU), ("reviewRequired", "{ type: boolean }"),
  ("publishedAt", NTS), ("publishedBy", NU), ("discardedAt", NTS), ("version", VER), ("createdAt", TS), ("createdBy", NU), ("updatedAt", TS), ("updatedBy", NU)]))
schemas.append(page("ConfigVersionPage", "ConfigVersion"))
schemas.append(obj("ConfigDraftCreate", None, [("basedOnVersionId", U), ("titleEn", TXT(1, 200)), ("titleAr", TXT(1, 200)), ("changeSummary", TXT(1, 4000))], required=["basedOnVersionId"]))
schemas.append(obj("ConfigDraftUpdate", "At least one member.", [("titleEn", TXT(1, 200)), ("titleAr", TXT(1, 200)), ("changeSummary", NTXT(1, 4000)), ("definition", "{ type: object }")], required=[]))
schemas.append(obj("ConfigElement", "One resolved element: the catalogue value overridden by the version's row (ADR-0039 §2).", [
  ("elementType", '{ $ref: "#/components/schemas/ConfigElementType" }'), ("stableKey", "{ type: string }"), ("origin", "{ type: string, enum: [source, admin] }"),
  ("removed", "{ type: boolean }"), ("ordinal", '{ type: ["integer", "null"], minimum: 1 }'), ("sourceRef", '{ type: [string, "null"] }'),
  ("catalogueAttributes", "{ type: object }"), ("attributes", "{ type: object, description: 'Validated per element type (packages/shared/src/schemas/studio.ts).' }"),
  ("overridden", "{ type: boolean }")]))
schemas.append(page("ConfigElementPage", "ConfigElement"))
schemas.append(obj("ConfigElementPut", None, [("origin", "{ type: string, enum: [source, admin] }"), ("ordinal", '{ type: ["integer", "null"], minimum: 1, maximum: 999 }'), ("attributes", "{ type: object }")], required=["attributes"]))
schemas.append(obj("ConfigDiffEntry", None, [
  ("elementType", "{ type: string }"), ("stableKey", "{ type: string }"), ("change", "{ type: string, enum: [added, removed, changed] }"),
  ("fields", '{ type: array, items: { type: object, additionalProperties: false, required: [field, from, to], properties: { field: { type: string }, from: {}, to: {} } } }')]))
schemas.append(obj("ConfigVersionDiff", "Side-by-side diff of two versions of the same kind and key.", [
  ("fromVersionId", U), ("toVersionId", U), ("titleChanged", "{ type: boolean }"), ("definitionChanged", "{ type: boolean }"),
  ("entries", '{ type: array, items: { $ref: "#/components/schemas/ConfigDiffEntry" } }')]))
schemas.append(obj("ConfigAffectedRecords", "Counts are integers, or null with unknownReason when not countable (never 0 for Unknown).", [
  ("versionId", U), ("transformations", '{ type: array, items: { type: object, additionalProperties: false, required: [transformationId, code, pinnedVersionId, records], properties: { transformationId: { $ref: "#/components/schemas/Uuid" }, code: { type: string }, pinnedVersionId: { $ref: "#/components/schemas/Uuid" }, records: { type: array, items: { type: object, additionalProperties: false, required: [recordType, count, unknownReason], properties: { recordType: { type: string }, count: { type: ["integer", "null"], minimum: 0 }, unknownReason: { type: [string, "null"] } } } } } } }')]))
schemas.append(obj("ConfigCheckRun", "One append-only check run over exactly one content hash.", [
  ("id", U), ("versionId", U), ("checkKind", "{ type: string, enum: [preview, compatibility, source_coverage, invariants] }"),
  ("contentSha256", SHA), ("result", "{ type: string, enum: [pass, warn, fail] }"), ("report", "{ type: object }"), ("runBy", U), ("createdAt", TS)]))
schemas.append(page("ConfigCheckRunPage", "ConfigCheckRun"))
schemas.append(obj("ConfigPreviewRequest", "Sample inputs for the sandbox (records per record type, formula inputs, sample submissions); at most 50 samples.", [
  ("samples", "{ type: array, maxItems: 50, items: { type: object, additionalProperties: false, required: [kind, input], properties: { kind: { type: string, enum: [record, formula, submission] }, recordType: { type: string, maxLength: 64 }, input: { type: object } } } }")]))
schemas.append(obj("ConfigReviewSubmit", None, [("note", TXT(1, 4000))], required=[]))
schemas.append(obj("ConfigReviewRequest", "The configured review of exactly one content hash (ADR-0039 §5).", [
  ("id", U), ("versionId", U), ("contentSha256", SHA), ("reviewerRoleCode", "{ type: string }"),
  ("status", "{ type: string, enum: [pending, approved, changes_requested, withdrawn] }"), ("requestNote", NTXT(1, 4000)),
  ("revisionProposalId", NU), ("requestedBy", U), ("requestedAt", TS), ("decidedBy", NU), ("decidedAt", NTS), ("decisionNote", NTXT(1, 4000)),
  ("version", VER), ("createdAt", TS), ("updatedAt", TS)]))
schemas.append(page("ConfigReviewRequestPage", "ConfigReviewRequest"))
schemas.append(obj("ConfigReviewDecision", "A note is required when changes are requested.", [("outcome", "{ type: string, enum: [approve, request_changes] }"), ("note", TXT(1, 4000))], required=["outcome"]))
schemas.append(obj("ConfigRollbackRequest", None, [("reason", TXT(3, 4000))]))
schemas.append(obj("ScoringWeight", None, [("criterionCode", "{ type: string, enum: [strategic_fit, financial_value, customer_impact, feasibility, time_to_value, risk_compliance] }"), ("weightPercent", "{ type: string, pattern: '^(100(\\\\.0{1,2})?|[0-9]{1,2}(\\\\.[0-9]{1,2})?)$', description: 'Percent as a decimal string with at most two decimals; > 0.' }")]))
schemas.append(obj("ScoringRubricLevel", "A null descriptor is shown as No descriptor defined (never invented).", [("score", "{ type: integer, minimum: 1, maximum: 5 }"), ("descriptorEn", NTXT(1, 500)), ("descriptorAr", NTXT(1, 500))]))
schemas.append(obj("ScoringRubric", None, [("criterionCode", "{ type: string, enum: [strategic_fit, financial_value, customer_impact, feasibility, time_to_value, risk_compliance] }"), ("levels", '{ type: array, minItems: 5, maxItems: 5, items: { $ref: "#/components/schemas/ScoringRubricLevel" } }')]))
schemas.append(obj("ScoringDefaults", "T06 default weights and rubric of one scoring_defaults version (REQ-PB-093).", [
  ("versionId", U), ("versionNo", "{ type: integer, minimum: 1 }"), ("status", "{ type: string, enum: [draft, published, retired] }"), ("isNewestPublished", "{ type: boolean }"),
  ("weights", '{ type: array, items: { $ref: "#/components/schemas/ScoringWeight" } }'),
  ("weightTotal", "{ type: string, description: 'Decimal sum of the weights; must be 100.00 to publish.' }"),
  ("rubrics", '{ type: array, items: { $ref: "#/components/schemas/ScoringRubric" } }'), ("version", VER)]))
schemas.append(obj("ScoringDefaultsPut", None, [("weights", '{ type: array, minItems: 2, maxItems: 6, items: { $ref: "#/components/schemas/ScoringWeight" } }'), ("rubrics", '{ type: array, maxItems: 6, items: { $ref: "#/components/schemas/ScoringRubric" } }')]))
schemas.append(obj("ConfigReviewPolicy", None, [("configKind", "{ type: string }"), ("reviewRequired", "{ type: boolean }"), ("reviewerRoleCode", "{ type: string }"), ("version", VER), ("updatedAt", TS), ("updatedBy", NU)]))
schemas.append(obj("ConfigReviewPolicyList", None, [("items", '{ type: array, items: { $ref: "#/components/schemas/ConfigReviewPolicy" } }')]))
schemas.append(obj("ConfigReviewPolicyUpdate", "At least one member.", [("reviewRequired", "{ type: boolean }"), ("reviewerRoleCode", "{ type: string, pattern: '^[A-Z_]{2,32}$' }")], required=[]))
schemas.append(obj("RevisionProposal", "S12-018: validation, impact and review routing of a proposed revision (append-only; exactly once per subject and content).", [
  ("id", U), ("transformationId", NU), ("subjectType", "{ type: string, enum: [methodology_version, benefit_formula_version] }"), ("subjectId", U),
  ("subjectVersion", "{ type: integer, minimum: 1 }"), ("contentSha256", SHA), ("validationResult", "{ type: string, enum: [pass, fail] }"),
  ("validationReport", "{ type: object }"), ("impact", "{ type: object, description: 'affectedTransformations, affectedRecords and affectedBenefits.' }"),
  ("reviewerRoleCode", "{ type: string }"), ("reviewTaskCount", "{ type: integer, minimum: 0 }"), ("createdAt", TS)]))
schemas.append(page("RevisionProposalPage", "RevisionProposal"))
schemas.append(obj("SourceCoverageSet", None, [
  ("setCode", "{ type: string, enum: [mode, phase, gate, template, tom_dimension, forum, benefit_lifecycle_step, launch_window, roaming_example, health_question] }"),
  ("expected", "{ type: integer, minimum: 0 }"), ("present", "{ type: integer, minimum: 0 }"),
  ("removed", '{ type: array, items: { type: string } }'), ("plannedFeatures", '{ type: array, items: { type: string } }'), ("result", "{ type: string, enum: [pass, warn, fail] }")]))
schemas.append(obj("SourceCoverageReport", "REQ-S02-001: 2 modes, 6 phases, 6 gates, 16 templates, 10 TOM dimensions, 5 forums, 6 lifecycle steps, 3 launch windows, 1 roaming example, 25 questions.", [
  ("versionId", U), ("contentSha256", SHA), ("result", "{ type: string, enum: [pass, warn, fail] }"), ("sets", '{ type: array, items: { $ref: "#/components/schemas/SourceCoverageSet" } }')]))
schemas.append(obj("SourceCoverageRunRequest", None, [("versionId", U)]))
schemas.append(obj("ConfigPin", None, [("kind", '{ $ref: "#/components/schemas/ConfigKind" }'), ("versionId", U), ("key", "{ type: string }"), ("versionNo", "{ type: integer, minimum: 1 }"), ("pinned", "{ type: boolean, description: 'false = no pin of this kind; version 1 of the default key applies.' }"), ("lastMigrationId", NU), ("pinnedAt", NTS), ("version", '{ type: ["integer", "null"], minimum: 1 }')]))
schemas.append(obj("ConfigPinList", None, [("items", '{ type: array, items: { $ref: "#/components/schemas/ConfigPin" } }')]))
schemas.append(obj("ConfigPinHistoryEntry", None, [("id", U), ("kind", "{ type: string }"), ("fromVersionId", U), ("toVersionId", U), ("migrationId", U), ("pinVersion", "{ type: integer, minimum: 2 }"), ("createdAt", TS), ("createdBy", U)]))
schemas.append(page("ConfigPinHistoryPage", "ConfigPinHistoryEntry"))
schemas.append(obj("MethodologyMigrationItem", None, [
  ("planRevision", "{ type: integer, minimum: 1 }"), ("ordinal", "{ type: integer, minimum: 1 }"),
  ("itemKind", "{ type: string, enum: [mapping, new_required_field, invalidated_calculation, reapproval, removed_element, unchanged_history] }"),
  ("elementType", '{ type: [string, "null"] }'), ("stableKey", '{ type: [string, "null"] }'), ("recordType", '{ type: [string, "null"] }'), ("recordId", NU),
  ("gateCode", '{ type: [string, "null"], pattern: "^G[1-6]$" }'), ("resolution", "{ type: string, enum: [automatic, needs_input, provided, acknowledged] }"), ("detail", "{ type: object }")]))
schemas.append(obj("MethodologyMigration", "The deliberate, approved move of one pin (ADR-0040 §1); items are the latest plan revision.", [
  ("id", U), ("transformationId", U), ("configKind", '{ $ref: "#/components/schemas/ConfigKind" }'), ("fromVersionId", U), ("toVersionId", U),
  ("status", "{ type: string, enum: [draft, submitted, changes_requested, approved, rejected, withdrawn, executed] }"), ("reason", TXT(3, 4000)),
  ("planRevision", "{ type: integer, minimum: 1 }"), ("planSha256", '{ type: [string, "null"], pattern: "^[0-9a-f]{64}$" }'), ("planReady", "{ type: boolean }"),
  ("items", '{ type: array, items: { $ref: "#/components/schemas/MethodologyMigrationItem" } }'),
  ("requestedBy", U), ("submittedBy", NU), ("submittedAt", NTS), ("approvalId", NU), ("decidedBy", NU), ("decidedAt", NTS),
  ("executedBy", NU), ("executedAt", NTS), ("withdrawnAt", NTS), ("version", VER), ("createdAt", TS), ("updatedAt", TS)]))
schemas.append(page("MethodologyMigrationPage", "MethodologyMigration"))
schemas.append(obj("MethodologyMigrationCreate", None, [("configKind", '{ $ref: "#/components/schemas/ConfigKind" }'), ("toVersionId", U), ("reason", TXT(3, 4000))]))
schemas.append(obj("MethodologyMigrationPreviewRequest", None, [("inputs", "{ type: array, maxItems: 200, items: { type: object, additionalProperties: false, required: [stableKey, value], properties: { stableKey: { type: string, maxLength: 96 }, value: {} } } }")]))
schemas.append(obj("MethodologyMigrationDecision", None, [("outcome", "{ type: string, enum: [approve, reject, request_changes] }"), ("rationale", TXT(1, 8000))]))
schemas.append(obj("GateReapproval", "A gate that needs business re-approval after a migration; the approved decision stays in history.", [
  ("id", U), ("migrationId", U), ("gateInstanceId", U), ("gateCode", "{ type: string, pattern: '^G[1-6]$' }"), ("approvedDecisionId", U),
  ("status", "{ type: string, enum: [required, satisfied, superseded] }"), ("satisfiedDecisionId", NU), ("workItemId", NU), ("resolvedAt", NTS), ("version", VER), ("createdAt", TS)]))
schemas.append(page("GateReapprovalPage", "GateReapproval"))
s = s.rstrip("\n") + "\n" + "".join(schemas)
open(F, "w").write(s)
print("operations added:", sum(len(re.findall(r"operationId: ", p)) for p in paths))
