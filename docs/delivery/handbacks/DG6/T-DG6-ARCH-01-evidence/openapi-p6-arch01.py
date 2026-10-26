# T-DG6-ARCH-01: appends the slice E/F operations (ADR-0051, ADR-0052) to docs/api/openapi.yaml as text, so every
# P1-P5 byte stays as it was (only info.version, one tag and appended paths/parameters/schemas change).
# Run once from the repository root: python3 docs/delivery/handbacks/DG6/T-DG6-ARCH-01-evidence/openapi-p6-arch01.py
import sys

P = "docs/api/openapi.yaml"
s = open(P, encoding="utf-8").read()
assert "version: 1.4.0-p5\n" in s and "operationId: getRecordSensitivity" not in s

MUT = """      security:
        - sessionCookie: []
          csrfToken: []
"""
STD_GET = """        "400": { $ref: "#/components/responses/ValidationError" }
        "401": { $ref: "#/components/responses/Unauthenticated" }
"""

paths = '''  /api/v1/transformations/{transformationId}/records/{recordType}/{recordId}/sensitivity:
    parameters:
      - $ref: "#/components/parameters/TransformationId"
      - $ref: "#/components/parameters/SensitiveRecordTypePath"
      - $ref: "#/components/parameters/SensitiveRecordId"
    get:
      tags: [access]
      operationId: getRecordSensitivity
      summary: "Whether a benefit, business case or evidence item is sensitive (the record must be readable, else 404). ETag \\"0\\" when it was never marked (not sensitive). ADR-0051 §2; REQ-S10-002."
      responses:
        "200":
          description: "OK."
          headers:
            ETag: { $ref: "#/components/headers/ETagOrZero" }
          content:
            application/json:
              schema: { $ref: "#/components/schemas/RecordSensitivity" }
''' + STD_GET + '''        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/RateLimited" }
    put:
      tags: [access]
      operationId: putRecordSensitivity
      summary: "Mark or unmark a record sensitive with a reason; If-Match \\"0\\" creates the flag row (sensitive_record.grant; TO, ADM_ACCESS). Audit record_sensitivity.marked / record_sensitivity.unmarked. 422 sensitivity.reason_required. ADR-0051 §2."
''' + MUT + '''      parameters:
        - $ref: "#/components/parameters/IfMatchOrZero"
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/RecordSensitivityUpdate" }
      responses:
        "200":
          description: "OK."
          headers:
            ETag: { $ref: "#/components/headers/ETag" }
          content:
            application/json:
              schema: { $ref: "#/components/schemas/RecordSensitivity" }
''' + STD_GET + '''        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409": { $ref: "#/components/responses/VersionConflict" }
        "422": { $ref: "#/components/responses/BusinessRule" }
        "428": { $ref: "#/components/responses/PreconditionRequired" }
        "429": { $ref: "#/components/responses/RateLimited" }
  /api/v1/admin/sensitive-grants:
    get:
      tags: [access]
      operationId: listSensitiveGrants
      summary: "Explicit grants on sensitive records of one transformation, newest first (sensitive_record.read; TO, AUD, ADM_ACCESS). A record title is shown only when the caller can read the record. ADR-0051 §2."
      parameters:
        - $ref: "#/components/parameters/SensitiveGrantTransformationQuery"
        - $ref: "#/components/parameters/SensitiveRecordTypeQuery"
        - { name: recordId, in: query, required: false, schema: { $ref: "#/components/schemas/Uuid" } }
        - { name: granteeUserId, in: query, required: false, schema: { $ref: "#/components/schemas/Uuid" } }
        - { name: status, in: query, required: false, schema: { type: string, enum: [active, revoked] } }
        - $ref: "#/components/parameters/Cursor"
        - $ref: "#/components/parameters/Limit"
      responses:
        "200":
          description: "OK."
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SensitiveGrantPage" }
''' + STD_GET + '''        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/RateLimited" }
    post:
      tags: [access]
      operationId: createSensitiveGrant
      summary: "Grant one user explicit access to a sensitive record (sensitive_record.grant; TO, ADM_ACCESS). 409 sensitive_grant.duplicate; 422 sensitive_grant.not_self, sensitive_grant.grantee_not_in_organization. Audit sensitive_record_grant.granted. ADR-0051 §2."
''' + MUT + '''      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/SensitiveGrantCreate" }
      responses:
        "201":
          description: "Created."
          headers:
            ETag: { $ref: "#/components/headers/ETag" }
            Location: { $ref: "#/components/headers/Location" }
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SensitiveGrant" }
''' + STD_GET + '''        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409": { $ref: "#/components/responses/Duplicate" }
        "422": { $ref: "#/components/responses/BusinessRule" }
        "429": { $ref: "#/components/responses/RateLimited" }
  /api/v1/admin/sensitive-grants/{grantId}:
    parameters:
      - $ref: "#/components/parameters/SensitiveGrantId"
    get:
      tags: [access]
      operationId: getSensitiveGrant
      summary: "One explicit grant (sensitive_record.read on its transformation). ADR-0051 §2."
      responses:
        "200":
          description: "OK."
          headers:
            ETag: { $ref: "#/components/headers/ETag" }
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SensitiveGrant" }
''' + STD_GET + '''        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/RateLimited" }
  /api/v1/admin/sensitive-grants/{grantId}/revoke:
    parameters:
      - $ref: "#/components/parameters/SensitiveGrantId"
    post:
      tags: [access]
      operationId: revokeSensitiveGrant
      summary: "Revoke an active grant with a reason (active -> revoked; revoked is terminal) (sensitive_record.grant). 422 invalid_transition. Audit sensitive_record_grant.revoked. ADR-0051 §2."
''' + MUT + '''      parameters:
        - $ref: "#/components/parameters/IfMatch"
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/SensitiveGrantRevoke" }
      responses:
        "200":
          description: "OK."
          headers:
            ETag: { $ref: "#/components/headers/ETag" }
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SensitiveGrant" }
''' + STD_GET + '''        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409": { $ref: "#/components/responses/VersionConflict" }
        "422": { $ref: "#/components/responses/BusinessRule" }
        "428": { $ref: "#/components/responses/PreconditionRequired" }
        "429": { $ref: "#/components/responses/RateLimited" }
  /api/v1/links/{token}:
    parameters:
      - $ref: "#/components/parameters/DeepLinkToken"
    get:
      tags: [tasks]
      operationId: resolveDeepLink
      summary: "Resolve a notification deep link for the signed-in caller, re-authorizing the target on every call (session). 404 for an unknown token; 403 deep_link.forbidden \\"You do not have access to this item.\\" when the caller cannot read the target now, with a body that never names the record. ADR-0051 §3; REQ-S12-024."
      responses:
        "200":
          description: "OK."
          content:
            application/json:
              schema: { $ref: "#/components/schemas/DeepLinkResolution" }
''' + STD_GET + '''        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/RateLimited" }
  /api/v1/transformations/{transformationId}/evidence/{evidenceId}/preview:
    parameters:
      - $ref: "#/components/parameters/TransformationId"
      - $ref: "#/components/parameters/EvidenceId"
    get:
      tags: [evidence]
      operationId: previewEvidenceContent
      summary: "Inline preview of the current content when its checked type is PNG, JPEG or GIF (magic bytes re-checked), served through the API under a sandboxing CSP with nosniff; never SVG, HTML, PDF or Office files (same authorization as the download, ADR-0051 §4). 403 evidence.parent_forbidden; 422 evidence.preview_unavailable. ADR-0052 §2; REQ-S13-011."
      responses:
        "200":
          description: "The image bytes (Content-Disposition inline; Content-Security-Policy with sandbox; X-Content-Type-Options nosniff; Cache-Control private, no-store)."
          content:
            image/png:
              schema: { type: string, contentMediaType: image/png }
            image/jpeg:
              schema: { type: string, contentMediaType: image/jpeg }
            image/gif:
              schema: { type: string, contentMediaType: image/gif }
''' + STD_GET + '''        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "422": { $ref: "#/components/responses/BusinessRule" }
        "429": { $ref: "#/components/responses/RateLimited" }
  /api/v1/admin/upload-policy:
    parameters:
      - $ref: "#/components/parameters/OrganizationIdQuery"
    get:
      tags: [security]
      operationId: getUploadPolicy
      summary: "The organization's effective upload allow-list and size limit; ETag \\"0\\" and isDefault=true when no policy row exists (security.read or upload_policy.configure). ADR-0052 §1."
      responses:
        "200":
          description: "OK."
          headers:
            ETag: { $ref: "#/components/headers/ETagOrZero" }
          content:
            application/json:
              schema: { $ref: "#/components/schemas/UploadPolicy" }
''' + STD_GET + '''        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/RateLimited" }
    put:
      tags: [security]
      operationId: putUploadPolicy
      summary: "Narrow the allow-list (a non-empty subset of the ten types) and the size limit (at most 26214400 bytes) with a reason; If-Match \\"0\\" creates the policy row (upload_policy.configure; ADM_TECH). Audit upload_policy.changed. ADR-0052 §1."
''' + MUT + '''      parameters:
        - $ref: "#/components/parameters/IfMatchOrZero"
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/UploadPolicyUpdate" }
      responses:
        "200":
          description: "OK."
          headers:
            ETag: { $ref: "#/components/headers/ETag" }
          content:
            application/json:
              schema: { $ref: "#/components/schemas/UploadPolicy" }
''' + STD_GET + '''        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409": { $ref: "#/components/responses/VersionConflict" }
        "428": { $ref: "#/components/responses/PreconditionRequired" }
        "429": { $ref: "#/components/responses/RateLimited" }
  /api/v1/admin/security/rate-limits:
    get:
      tags: [security]
      operationId: getSecurityRateLimits
      summary: "The configured rate-limit classes, their budgets per minute, keys and operations (security.read; ADM_TECH, AUD). No counters, IPs or user ids. ADR-0052 §4."
      parameters:
        - $ref: "#/components/parameters/OrganizationIdQuery"
      responses:
        "200":
          description: "OK."
          content:
            application/json:
              schema: { $ref: "#/components/schemas/RateLimitMatrix" }
''' + STD_GET + '''        "403": { $ref: "#/components/responses/Forbidden" }
        "429": { $ref: "#/components/responses/RateLimited" }
  /api/v1/audit-events:
    get:
      tags: [audit]
      operationId: listAuditEvents
      summary: "Administration > Audit: audit events of one organization within the caller's audit_event.read scope (AUD; ADM_TECH and ADM_ACCESS see organization-level events and the transformations they are assigned to), newest first. Events of a sensitive record the caller is not admitted to are listed with changes and reason null and redacted true. ADR-0052 §8; REQ-S16-032."
      parameters:
        - $ref: "#/components/parameters/OrganizationIdQuery"
        - { name: transformationId, in: query, required: false, schema: { $ref: "#/components/schemas/Uuid" } }
        - { name: recordType, in: query, required: false, schema: { type: string, pattern: "^[a-z][a-z0-9_]{0,63}$" } }
        - { name: recordId, in: query, required: false, schema: { $ref: "#/components/schemas/Uuid" } }
        - { name: actorUserId, in: query, required: false, schema: { $ref: "#/components/schemas/Uuid" } }
        - { name: action, in: query, required: false, schema: { type: string, pattern: "^[a-z_]+\\\\.[a-z_.]+$", maxLength: 128 } }
        - { name: from, in: query, required: false, schema: { $ref: "#/components/schemas/Timestamp" } }
        - { name: to, in: query, required: false, schema: { $ref: "#/components/schemas/Timestamp" } }
        - $ref: "#/components/parameters/Cursor"
        - $ref: "#/components/parameters/Limit"
      responses:
        "200":
          description: "OK."
          content:
            application/json:
              schema: { $ref: "#/components/schemas/GlobalAuditEventPage" }
''' + STD_GET + '''        "403": { $ref: "#/components/responses/Forbidden" }
        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/RateLimited" }
  /api/v1/audit-events/{auditEventId}:
    parameters:
      - $ref: "#/components/parameters/AuditEventId"
    get:
      tags: [audit]
      operationId: getAuditEvent
      summary: "One audit event within the caller's audit_event.read scope (404 otherwise). ADR-0052 §8."
      responses:
        "200":
          description: "OK."
          content:
            application/json:
              schema: { $ref: "#/components/schemas/GlobalAuditEvent" }
''' + STD_GET + '''        "404": { $ref: "#/components/responses/NotFound" }
        "429": { $ref: "#/components/responses/RateLimited" }
'''

params = '''    SensitiveRecordTypePath:
      name: recordType
      in: path
      required: true
      description: "A record type that can be sensitive (ADR-0051 §2; D-195 Q3)."
      schema: { $ref: "#/components/schemas/SensitiveRecordType" }
    SensitiveRecordId:
      name: recordId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    SensitiveRecordTypeQuery:
      name: recordType
      in: query
      required: false
      schema: { $ref: "#/components/schemas/SensitiveRecordType" }
    SensitiveGrantTransformationQuery:
      name: transformationId
      in: query
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    SensitiveGrantId:
      name: grantId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    DeepLinkToken:
      name: token
      in: path
      required: true
      description: "The opaque deep-link token of a notification (43 base64url characters). It is an identifier, never a credential (ADR-0051 §3)."
      schema: { type: string, pattern: "^[A-Za-z0-9_-]{43}$" }
    AuditEventId:
      name: auditEventId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
'''

schemas = '''    SensitiveRecordType:
      type: string
      enum: [benefit, business_case, evidence]
    RecordSensitivity:
      type: object
      required: [transformationId, recordType, recordId, isSensitive, reason, version, updatedAt, updatedBy, canManage]
      additionalProperties: false
      properties:
        transformationId: { $ref: "#/components/schemas/Uuid" }
        recordType: { $ref: "#/components/schemas/SensitiveRecordType" }
        recordId: { $ref: "#/components/schemas/Uuid" }
        isSensitive: { type: boolean, description: "False when the record was never marked (version 0)." }
        reason: { type: [string, "null"], maxLength: 1000 }
        version: { type: integer, minimum: 0, description: "0 when no flag row exists; If-Match \\"0\\" creates it." }
        updatedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        updatedBy: { $ref: "#/components/schemas/NullableUuid" }
        canManage: { type: boolean, description: "The caller holds sensitive_record.grant on the transformation." }
    RecordSensitivityUpdate:
      type: object
      required: [isSensitive, reason]
      additionalProperties: false
      properties:
        isSensitive: { type: boolean }
        reason: { type: string, minLength: 3, maxLength: 1000 }
    SensitiveGrant:
      type: object
      required:
        [id, transformationId, recordType, recordId, recordTitle, recordTitleRedacted, granteeUserId, granteeDisplayName, reason, status, grantedBy, grantedAt, revokedAt, revokedBy, revokeReason, version]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        recordType: { $ref: "#/components/schemas/SensitiveRecordType" }
        recordId: { $ref: "#/components/schemas/Uuid" }
        recordTitle: { type: [string, "null"], description: "Null when the caller cannot read the record (ADR-0051 §2)." }
        recordTitleRedacted: { type: boolean }
        granteeUserId: { $ref: "#/components/schemas/Uuid" }
        granteeDisplayName: { type: [string, "null"] }
        reason: { type: string, minLength: 3, maxLength: 1000 }
        status: { type: string, enum: [active, revoked] }
        grantedBy: { $ref: "#/components/schemas/Uuid" }
        grantedAt: { $ref: "#/components/schemas/Timestamp" }
        revokedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        revokedBy: { $ref: "#/components/schemas/NullableUuid" }
        revokeReason: { type: [string, "null"], maxLength: 1000 }
        version: { $ref: "#/components/schemas/Version" }
    SensitiveGrantPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/SensitiveGrant" } }
        nextCursor: { type: [string, "null"] }
    SensitiveGrantCreate:
      type: object
      required: [transformationId, recordType, recordId, granteeUserId, reason]
      additionalProperties: false
      properties:
        transformationId: { $ref: "#/components/schemas/Uuid" }
        recordType: { $ref: "#/components/schemas/SensitiveRecordType" }
        recordId: { $ref: "#/components/schemas/Uuid" }
        granteeUserId: { $ref: "#/components/schemas/Uuid" }
        reason: { type: string, minLength: 3, maxLength: 1000 }
    SensitiveGrantRevoke:
      type: object
      required: [reason]
      additionalProperties: false
      properties:
        reason: { type: string, minLength: 3, maxLength: 1000 }
    DeepLinkResolution:
      type: object
      required: [linkPath, recordType, recordId]
      additionalProperties: false
      properties:
        linkPath: { type: string, pattern: "^/[^/\\\\\\\\]", maxLength: 500 }
        recordType: { type: [string, "null"] }
        recordId: { $ref: "#/components/schemas/NullableUuid" }
    UploadType:
      type: string
      enum: [pdf, docx, xlsx, pptx, csv, txt, png, jpeg, gif, svg]
    UploadPolicy:
      type: object
      required: [organizationId, allowedTypes, maxBytes, isDefault, inlinePreviewTypes, reason, version, updatedAt]
      additionalProperties: false
      properties:
        organizationId: { $ref: "#/components/schemas/Uuid" }
        allowedTypes: { type: array, minItems: 1, maxItems: 10, uniqueItems: true, items: { $ref: "#/components/schemas/UploadType" } }
        maxBytes: { type: integer, minimum: 1, maximum: 26214400 }
        isDefault: { type: boolean, description: "True when no policy row exists and the ADR-0052 §1 default applies." }
        inlinePreviewTypes:
          type: array
          description: "Always [png, jpeg, gif] intersected with allowedTypes; SVG is never previewed inline."
          items: { type: string, enum: [png, jpeg, gif] }
        reason: { type: [string, "null"], maxLength: 1000 }
        version: { type: integer, minimum: 0 }
        updatedAt: { $ref: "#/components/schemas/NullableTimestamp" }
    UploadPolicyUpdate:
      type: object
      required: [allowedTypes, maxBytes, reason]
      additionalProperties: false
      properties:
        allowedTypes: { type: array, minItems: 1, maxItems: 10, uniqueItems: true, items: { $ref: "#/components/schemas/UploadType" } }
        maxBytes: { type: integer, minimum: 1, maximum: 26214400 }
        reason: { type: string, minLength: 3, maxLength: 1000 }
    RateLimitMatrix:
      type: object
      required: [classes]
      additionalProperties: false
      properties:
        classes:
          type: array
          items:
            type: object
            required: [name, variable, perMinute, keyedBy, operationIds]
            additionalProperties: false
            properties:
              name: { type: string, enum: [global, auth, upload, search, assistant, webhook, export] }
              variable: { type: string, pattern: "^[A-Z][A-Z0-9_]*$" }
              perMinute: { type: integer, minimum: 1 }
              keyedBy: { type: string, enum: [user_or_ip, ip, endpoint_key] }
              operationIds: { type: array, items: { type: string } }
    GlobalAuditEvent:
      type: object
      required:
        [id, seq, occurredAt, organizationId, action, recordType, recordId, transformationId, actor, onBehalfOfUserId, priorVersion, newVersion, reason, requestId, source, changes, redacted]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        seq: { type: string, pattern: "^[0-9]+$", description: "Monotonic sequence (bigint as string)." }
        occurredAt: { $ref: "#/components/schemas/Timestamp" }
        organizationId: { $ref: "#/components/schemas/NullableUuid" }
        action: { type: string, pattern: "^[a-z_]+\\\\.[a-z_.]+$" }
        recordType: { type: string }
        recordId: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/NullableUuid" }
        actor:
          type: object
          required: [type, userId, displayName]
          additionalProperties: false
          properties:
            type: { type: string, enum: [user, service, system] }
            userId: { $ref: "#/components/schemas/NullableUuid" }
            displayName: { type: [string, "null"] }
        onBehalfOfUserId: { $ref: "#/components/schemas/NullableUuid" }
        priorVersion: { type: [integer, "null"], minimum: 1 }
        newVersion: { type: [integer, "null"], minimum: 1 }
        reason: { type: [string, "null"] }
        requestId: { type: [string, "null"] }
        source: { type: string, enum: [api, worker, cli, migration] }
        changes:
          description: "As AuditEvent.changes; null when redacted (a sensitive record the caller is not admitted to, ADR-0051 §2)."
          oneOf:
            - type: object
              additionalProperties:
                type: object
                required: [from, to]
                additionalProperties: false
                properties:
                  from: {}
                  to: {}
            - { type: "null" }
        redacted: { type: boolean }
    GlobalAuditEventPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/GlobalAuditEvent" } }
        nextCursor: { type: [string, "null"] }
'''

tag = '''  - name: security
    description: The upload allow-list and size limit, and the rate-limit matrix (P6, ADR-0052).
'''

s = s.replace("version: 1.4.0-p5\n", "version: 1.5.0-p6\n", 1)
# The response-only Permission enum gains the five 0100 codes (an additive v1 change, as every P5 task did).
_perm_tail = "        - branding.configure\n        - demo.reset\n    RoleCode:"
assert s.count(_perm_tail) == 1
s = s.replace(_perm_tail, "        - branding.configure\n        - demo.reset\n        - sensitive_record.grant\n"
    "        - sensitive_record.read\n        - audit_event.read\n        - upload_policy.configure\n        - security.read\n    RoleCode:", 1)
s = s.replace("security:\n  - sessionCookie: []\npaths:\n", tag + "security:\n  - sessionCookie: []\npaths:\n", 1)
assert s.count("\ncomponents:\n") == 1
s = s.replace("\ncomponents:\n", "\n" + paths + "components:\n", 1)
assert s.count("\n  headers:\n") == 1
s = s.replace("\n  headers:\n", "\n" + params + "  headers:\n", 1)
if not s.endswith("\n"):
    s += "\n"
s += schemas
open(P, "w", encoding="utf-8").write(s)
print("operations:", s.count("operationId:"))
