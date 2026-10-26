# T-DG6-ARCH-02: appends the slice J/C operations (ADR-0053, ADR-0054) to docs/api/openapi.yaml as text, so every
# P1-P5 and ARCH-01 byte stays as it was (only the Permission enum, two tags and appended paths/parameters/schemas
# change; info.version is already 1.5.0-p6).
# Run once from the repository root: python3 docs/delivery/handbacks/DG6/T-DG6-ARCH-02-evidence/openapi-p6-arch02.py
P = "docs/api/openapi.yaml"
s = open(P, encoding="utf-8").read()
assert "version: 1.5.0-p6\n" in s and "operationId: listOperationalExceptions" not in s

MUT = """      security:
        - sessionCookie: []
          csrfToken: []
"""
R400 = '        "400": { $ref: "#/components/responses/ValidationError" }\n'
R401 = '        "401": { $ref: "#/components/responses/Unauthenticated" }\n'
R403 = '        "403": { $ref: "#/components/responses/Forbidden" }\n'
R404 = '        "404": { $ref: "#/components/responses/NotFound" }\n'
R409 = '        "409": { $ref: "#/components/responses/VersionConflict" }\n'
R422 = '        "422": { $ref: "#/components/responses/BusinessRule" }\n'
R428 = '        "428": { $ref: "#/components/responses/PreconditionRequired" }\n'
R429 = '        "429": { $ref: "#/components/responses/RateLimited" }\n'
READ = R400 + R401 + R403 + R404 + R429
WRITE = R400 + R401 + R403 + R404 + R409 + R422 + R428 + R429
TEST = R400 + R401 + R403 + R404 + R422 + R429


def ok(schema, etag=None):
    h = f"""          headers:
            ETag: {{ $ref: "#/components/headers/{etag}" }}
""" if etag else ""
    return f"""        "200":
          description: "OK."
{h}          content:
            application/json:
              schema: {{ $ref: "#/components/schemas/{schema}" }}
"""


def body(schema):
    return f"""      requestBody:
        required: true
        content:
          application/json:
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
IFZ = '        - $ref: "#/components/parameters/IfMatchOrZero"\n'
PAGE = '        - $ref: "#/components/parameters/Cursor"\n        - $ref: "#/components/parameters/Limit"\n'
ORGQ = '        - $ref: "#/components/parameters/OrganizationIdQuery"\n'

paths = "  /api/v1/admin/operations/exceptions:\n" + op(
    "get", "operations", "listOperationalExceptions",
    "Operational exceptions, newest occurrence first (operations.read; ADM_TECH, TO, KDS, TD, AUD). An organization-scope holder sees the organization's exceptions and the platform ones; a transformation-scope holder sees only exceptions linked to a KPI of that transformation. Default status filter: open and acknowledged. ADR-0053 §2, §9; REQ-S12-019.",
    ok("OperationalExceptionPage") + READ,
    ORGQ
    + '        - { name: status, in: query, required: false, schema: { type: array, items: { $ref: "#/components/schemas/OperationalExceptionStatus" } }, style: form, explode: true }\n'
    + '        - { name: sourceKind, in: query, required: false, schema: { $ref: "#/components/schemas/OperationalExceptionSourceKind" } }\n'
    + '        - { name: failureClass, in: query, required: false, schema: { $ref: "#/components/schemas/OperationalExceptionFailureClass" } }\n'
    + PAGE)
paths += """  /api/v1/admin/operations/exceptions/{exceptionId}:
    parameters:
      - $ref: "#/components/parameters/OperationalExceptionId"
""" + op("get", "operations", "getOperationalException",
         "One operational exception with its event history and the KPIs it makes stale (each with its DG4 freshness label and last known value; a KPI the caller cannot read is counted in hiddenKpiCount, never named). ADR-0053 §2.",
         ok("OperationalExceptionDetail", "ETag") + READ)
paths += """  /api/v1/admin/operations/exceptions/{exceptionId}/acknowledge:
    parameters:
      - $ref: "#/components/parameters/OperationalExceptionId"
""" + op("post", "operations", "acknowledgeOperationalException",
         "Acknowledge an open exception with an optional note (operations.acknowledge; ADM_TECH, KDS). Audit operational_exception.acknowledged. 409 operations.exception_not_open. ADR-0053 §2.",
         ok("OperationalExceptionDetail", "ETag") + WRITE, IFM, True, "OperationalExceptionAcknowledge")
paths += """  /api/v1/admin/operations/exceptions/{exceptionId}/resolve:
    parameters:
      - $ref: "#/components/parameters/OperationalExceptionId"
""" + op("post", "operations", "resolveOperationalException",
         "Resolve an open or acknowledged exception with a note (operations.acknowledge; ADM_TECH, KDS). Resolving never changes a KPI value or its freshness label. Audit operational_exception.resolved. 409 operations.exception_resolved. ADR-0053 §2.",
         ok("OperationalExceptionDetail", "ETag") + WRITE, IFM, True, "OperationalExceptionResolve")
paths += "  /api/v1/admin/operations/heartbeat:\n" + op(
    "get", "operations", "getWorkerHeartbeat",
    "The worker heartbeat: alive when the newest beat is at most 90 s old, stale when older, unknown when no worker ever beat (never shown as alive). operations.read. ADR-0053 §6.",
    ok("WorkerHeartbeatStatus") + READ)
paths += "  /api/v1/admin/service-identities:\n" + op(
    "get", "operations", "listServiceIdentities",
    "The service identities of jobs and connectors, by code (operations.read). ADR-0053 §1; REQ-S16-029.",
    ok("ServiceIdentityPage") + READ,
    ORGQ + '        - { name: subjectKind, in: query, required: false, schema: { type: string, enum: [job, connector] } }\n' + PAGE)
paths += """  /api/v1/admin/service-identities/{serviceIdentityId}:
    parameters:
      - $ref: "#/components/parameters/ServiceIdentityId"
""" + op("get", "operations", "getServiceIdentity",
         "One service identity: its declaration (permission ceiling, scope, sensitive access) and its current grant. operations.read. ADR-0053 §1.",
         ok("ServiceIdentity", "ETag") + READ) + op(
    "put", "operations", "putServiceIdentity",
    "Narrow or restore the granted permissions within the declaration, with a reason (service_identity.configure; ADM_TECH). Audit service_identity.grant_changed. 422 service_identity.grant_exceeds_declaration. ADR-0053 §1.",
    ok("ServiceIdentity", "ETag") + WRITE, IFM, True, "ServiceIdentityUpdate")
paths += "  /api/v1/admin/identity:\n" + op(
    "get", "platform-admin", "getIdentitySettings",
    "The effective identity-provider settings, read-only (identity.read; ADM_TECH, ADM_ACCESS, AUD): issuer, client id, scopes, the accepted audience and claim mapping, and where the SAML broker is documented. Never the client secret. ADR-0054 §1; REQ-S16-007.",
    ok("IdentitySettings") + READ)
paths += "  /api/v1/admin/storage:\n" + op(
    "get", "platform-admin", "getStorageSetting",
    "The effective evidence-storage setting (storage.configure or operations.read): the driver, its source (environment default or saved setting) and, for s3, the endpoint, bucket and credential REFERENCES (never values). ETag 0 when no setting was saved. Evidence is never served from a public URL in either mode. ADR-0054 §2; REQ-S16-006.",
    ok("StorageSetting", "ETagOrZero") + READ) + op(
    "put", "platform-admin", "putStorageSetting",
    "Save the storage setting with a reason; If-Match 0 creates it (storage.configure; ADM_TECH). New uploads use the saved driver; earlier files stay readable from the store that holds them. Audit storage_setting.changed. 422 storage.s3_incomplete, storage.secret_ref_invalid, storage.test_required. ADR-0054 §2.",
    ok("StorageSetting", "ETag") + WRITE, IFZ, True, "StorageSettingUpdate")
paths += "  /api/v1/admin/storage/test:\n" + op(
    "post", "platform-admin", "testStorageSetting",
    "Test a candidate or the saved storage setting outside any transaction: write, read back, checksum and delete a probe object, and check that an unauthenticated read is refused (storage.configure; ADM_TECH). Audit storage_setting.tested. Never returns a URL. ADR-0054 §2.",
    ok("StorageTestResult") + TEST, "", True, "StorageTestRequest")
paths += "  /api/v1/admin/notification-channels:\n" + op(
    "get", "platform-admin", "listNotificationChannels",
    "The two notification channels of an organization (email, enterprise_messaging), configured or not; the in-app inbox is always on and is not listed. notification_channel.configure or operations.read. ADR-0054 §3; REQ-S12-023.",
    ok("NotificationChannelPage") + READ, ORGQ + PAGE)
paths += """  /api/v1/admin/notification-channels/{channelKind}:
    parameters:
      - $ref: "#/components/parameters/ChannelKindPath"
      - $ref: "#/components/parameters/OrganizationIdQuery"
""" + op("get", "platform-admin", "getNotificationChannel",
         "One channel; ETag 0 when it was never configured (then it is disabled). ADR-0054 §3.",
         ok("NotificationChannel", "ETagOrZero") + READ) + op(
    "put", "platform-admin", "putNotificationChannel",
    "Configure, enable or disable a channel with a reason; If-Match 0 creates it (notification_channel.configure; ADM_TECH). SMTP credentials are SecretRefs. enterprise_messaging cannot be enabled (no adapter ships). Audit notification_channel.changed. 422 notification_channel.email_incomplete, notification_channel.adapter_unavailable. ADR-0054 §3.",
    ok("NotificationChannel", "ETag") + WRITE, IFZ, True, "NotificationChannelUpdate")
paths += """  /api/v1/admin/notification-channels/{channelKind}/test:
    parameters:
      - $ref: "#/components/parameters/ChannelKindPath"
      - $ref: "#/components/parameters/OrganizationIdQuery"
""" + op("post", "platform-admin", "testNotificationChannel",
         "Send one test message to the caller's own address through the saved channel, outside any transaction (notification_channel.configure; ADM_TECH). Audit notification_channel.tested. 422 notification_channel.not_configured, notification_channel.no_recipient_address. ADR-0054 §3.",
         ok("NotificationChannelTestResult") + TEST, "", True, "NotificationChannelTestRequest")
paths += "  /api/v1/admin/notification-deliveries:\n" + op(
    "get", "platform-admin", "listNotificationDeliveries",
    "External channel deliveries, newest first (notification_channel.configure or operations.read). Never the message text or the recipient address. ADR-0054 §3.",
    ok("NotificationDeliveryPage") + READ,
    ORGQ + '        - { name: status, in: query, required: false, schema: { type: string, enum: [pending, sent, failed, skipped] } }\n'
    + '        - { name: channelKind, in: query, required: false, schema: { $ref: "#/components/schemas/NotificationChannelKind" } }\n' + PAGE)

params = """    OperationalExceptionId:
      name: exceptionId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    ServiceIdentityId:
      name: serviceIdentityId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    ChannelKindPath:
      name: channelKind
      in: path
      required: true
      schema: { $ref: "#/components/schemas/NotificationChannelKind" }
"""

EXC_PROPS = """        id: { $ref: "#/components/schemas/Uuid" }
        organizationId: { $ref: "#/components/schemas/NullableUuid" }
        sourceKind: { $ref: "#/components/schemas/OperationalExceptionSourceKind" }
        sourceCode: { type: string, maxLength: 200 }
        failureClass: { $ref: "#/components/schemas/OperationalExceptionFailureClass" }
        dedupKey: { type: string }
        status: { $ref: "#/components/schemas/OperationalExceptionStatus" }
        occurrenceCount: { type: integer, minimum: 1 }
        firstOccurredAt: { $ref: "#/components/schemas/Timestamp" }
        lastOccurredAt: { $ref: "#/components/schemas/Timestamp" }
        lastErrorCode: { type: string, maxLength: 100 }
        lastErrorMessage: { type: string, maxLength: 2000, description: "Redacted before it is stored (ADR-0053 §4)." }
        serviceIdentityId: { $ref: "#/components/schemas/NullableUuid" }
        acknowledgedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        acknowledgedBy: { $ref: "#/components/schemas/NullableUuid" }
        acknowledgeNote: { type: [string, "null"], maxLength: 1000 }
        resolvedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        resolvedBy: { $ref: "#/components/schemas/NullableUuid" }
        resolution: { type: [string, "null"], enum: [manual, recovered, null] }
        resolutionNote: { type: [string, "null"], maxLength: 1000 }
        linkedKpiCount: { type: integer, minimum: 0 }
        version: { type: integer, minimum: 1 }
"""
EXC_REQ = "id, organizationId, sourceKind, sourceCode, failureClass, dedupKey, status, occurrenceCount, firstOccurredAt, lastOccurredAt, lastErrorCode, lastErrorMessage, serviceIdentityId, acknowledgedAt, acknowledgedBy, acknowledgeNote, resolvedAt, resolvedBy, resolution, resolutionNote, linkedKpiCount, version"
SECRET_REF = '{ oneOf: [{ $ref: "#/components/schemas/SecretRef" }, { type: "null" }] }'

schemas = """    OperationalExceptionStatus:
      type: string
      enum: [open, acknowledged, resolved]
    OperationalExceptionSourceKind:
      type: string
      enum: [job, connector, data_freshness, worker]
    OperationalExceptionFailureClass:
      type: string
      enum: [job_failed, connector_run_failed, connector_unreachable, connector_credentials_rejected, data_stale, heartbeat_missed]
    OperationalException:
      type: object
      required: [""" + EXC_REQ + """]
      additionalProperties: false
      properties:
""" + EXC_PROPS + """    OperationalExceptionDetail:
      type: object
      required: [""" + EXC_REQ + """, linkedKpis, hiddenKpiCount, events]
      additionalProperties: false
      properties:
""" + EXC_PROPS + """        linkedKpis:
          type: array
          items:
            type: object
            required: [kpiDefinitionId, transformationId, name, unitKind, freshness, lastValue, lastValueAt]
            additionalProperties: false
            properties:
              kpiDefinitionId: { $ref: "#/components/schemas/Uuid" }
              transformationId: { $ref: "#/components/schemas/Uuid" }
              name: { type: string }
              unitKind: { type: string, enum: [currency, percentage, count, ratio, duration, score, other] }
              freshness: { type: string, enum: [fresh, stale, unknown], description: "The DG4 freshness label (ADR-0028); never computed here." }
              lastValue: { type: [string, "null"], pattern: "^-?[0-9]+(\\\\.[0-9]+)?$", description: "Last known accepted value as a decimal string; null = Unknown (never 0)." }
              lastValueAt: { $ref: "#/components/schemas/NullableTimestamp" }
        hiddenKpiCount: { type: integer, minimum: 0 }
        events:
          type: array
          items:
            type: object
            required: [recordVersion, eventKind, status, occurrenceCount, errorCode, actorUserId, note, occurredAt]
            additionalProperties: false
            properties:
              recordVersion: { type: integer, minimum: 1 }
              eventKind: { type: string, enum: [opened, recurred, acknowledged, resolved, updated] }
              status: { $ref: "#/components/schemas/OperationalExceptionStatus" }
              occurrenceCount: { type: integer, minimum: 1 }
              errorCode: { type: string }
              actorUserId: { $ref: "#/components/schemas/NullableUuid" }
              note: { type: [string, "null"] }
              occurredAt: { $ref: "#/components/schemas/Timestamp" }
    OperationalExceptionPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/OperationalException" } }
        nextCursor: { type: [string, "null"] }
    OperationalExceptionAcknowledge:
      type: object
      required: [note]
      additionalProperties: false
      properties:
        note: { type: [string, "null"], minLength: 3, maxLength: 1000 }
    OperationalExceptionResolve:
      type: object
      required: [note]
      additionalProperties: false
      properties:
        note: { type: string, minLength: 3, maxLength: 1000 }
    WorkerHeartbeatStatus:
      type: object
      required: [status, checkedAt, staleAfterSeconds, newestBeatAt, instances]
      additionalProperties: false
      properties:
        status: { type: string, enum: [alive, stale, unknown] }
        checkedAt: { $ref: "#/components/schemas/Timestamp" }
        staleAfterSeconds: { type: integer, minimum: 1 }
        newestBeatAt: { $ref: "#/components/schemas/NullableTimestamp" }
        instances:
          type: array
          items:
            type: object
            required: [instanceKey, appVersion, startedAt, lastBeatAt, beatCount, queueCount, status]
            additionalProperties: false
            properties:
              instanceKey: { type: string }
              appVersion: { type: string }
              startedAt: { $ref: "#/components/schemas/Timestamp" }
              lastBeatAt: { $ref: "#/components/schemas/Timestamp" }
              beatCount: { type: string, pattern: "^[0-9]+$" }
              queueCount: { type: integer, minimum: 0 }
              status: { type: string, enum: [alive, stale] }
    ServiceIdentity:
      type: object
      required: [id, code, subjectKind, queueName, connectorId, scopeLevel, organizationId, declaredPermissionCodes, grantedPermissionCodes, sensitiveAccess, labelEn, labelAr, reason, version, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        code: { type: string, pattern: "^(job|connector):" }
        subjectKind: { type: string, enum: [job, connector] }
        queueName: { type: [string, "null"] }
        connectorId: { $ref: "#/components/schemas/NullableUuid" }
        scopeLevel: { type: string, enum: [platform, organization] }
        organizationId: { $ref: "#/components/schemas/NullableUuid" }
        declaredPermissionCodes: { type: array, items: { $ref: "#/components/schemas/PermissionCode" } }
        grantedPermissionCodes: { type: array, items: { $ref: "#/components/schemas/PermissionCode" } }
        sensitiveAccess: { type: string, enum: [none, aggregate_only] }
        labelEn: { type: string }
        labelAr: { type: string }
        reason: { type: string }
        version: { type: integer, minimum: 1 }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    ServiceIdentityPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/ServiceIdentity" } }
        nextCursor: { type: [string, "null"] }
    ServiceIdentityUpdate:
      type: object
      required: [grantedPermissionCodes, reason]
      additionalProperties: false
      properties:
        grantedPermissionCodes: { type: array, maxItems: 40, uniqueItems: true, items: { $ref: "#/components/schemas/PermissionCode" } }
        reason: { type: string, minLength: 3, maxLength: 1000 }
    IdentitySettings:
      type: object
      required: [authMode, issuer, clientId, clientSecretConfigured, scopes, expectedAudience, pkceMethod, claimMapping, samlBrokerDocument]
      additionalProperties: false
      properties:
        authMode: { type: string, enum: [oidc, dev] }
        issuer: { type: [string, "null"], description: "The one accepted issuer (exact match); a token from any other issuer or realm is refused." }
        clientId: { type: [string, "null"] }
        clientSecretConfigured: { type: boolean }
        scopes: { type: array, items: { type: string } }
        expectedAudience: { type: [string, "null"], description: "Equals clientId; an ID token whose aud does not contain it is refused." }
        pkceMethod: { type: [string, "null"], enum: [S256, null] }
        claimMapping:
          type: object
          required: [subject, email, displayName]
          additionalProperties: false
          properties:
            subject: { type: string, enum: [sub] }
            email: { type: string, enum: [email] }
            displayName: { type: string, enum: [name] }
        samlBrokerDocument: { type: string, description: "Repository path of the SAML broker document (docs/operations/identity-saml-broker.md)." }
    SecretRef:
      type: object
      required: [provider, name]
      additionalProperties: false
      description: "A reference to a secret held by a SecretProvider (ADR-0052 §5); never the secret value."
      properties:
        provider: { type: string, pattern: "^[a-z][a-z0-9_]{0,31}$" }
        name: { type: string, pattern: "^[A-Za-z_][A-Za-z0-9_./-]{0,127}$" }
    StorageS3Input:
      type: object
      required: [endpoint, region, bucket, keyPrefix, forcePathStyle, accessKeyRef, secretKeyRef]
      additionalProperties: false
      properties:
        endpoint: { type: string, maxLength: 300, pattern: "^https?://" }
        region: { type: string, pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }
        bucket: { type: string, pattern: "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$" }
        keyPrefix: { type: [string, "null"], pattern: "^[a-z0-9][a-z0-9_/-]{0,99}$" }
        forcePathStyle: { type: boolean }
        accessKeyRef: { $ref: "#/components/schemas/SecretRef" }
        secretKeyRef: { $ref: "#/components/schemas/SecretRef" }
    StorageSetting:
      type: object
      required: [driver, source, s3, publicUrls, reason, version, updatedAt]
      additionalProperties: false
      properties:
        driver: { type: string, enum: [filesystem, s3] }
        source: { type: string, enum: [environment, setting] }
        s3:
          oneOf:
            - $ref: "#/components/schemas/StorageS3Input"
            - { type: "null" }
        publicUrls: { type: boolean, enum: [false], description: "Always false: bytes are proxied by the API in both modes (ADR-0010 §2, D-195 Q2)." }
        reason: { type: [string, "null"] }
        version: { type: integer, minimum: 0 }
        updatedAt: { $ref: "#/components/schemas/NullableTimestamp" }
    StorageSettingUpdate:
      type: object
      required: [driver, s3, reason]
      additionalProperties: false
      properties:
        driver: { type: string, enum: [filesystem, s3] }
        s3:
          oneOf:
            - $ref: "#/components/schemas/StorageS3Input"
            - { type: "null" }
        reason: { type: string, minLength: 3, maxLength: 1000 }
    StorageTestRequest:
      type: object
      required: [candidate]
      additionalProperties: false
      properties:
        candidate:
          description: "Null tests the saved (or environment) setting."
          oneOf:
            - $ref: "#/components/schemas/StorageS3Input"
            - { type: "null" }
    StorageTestResult:
      type: object
      required: [outcome, driver, checks, errorCode, durationMs, testedAt]
      additionalProperties: false
      properties:
        outcome: { type: string, enum: [passed, failed] }
        driver: { type: string, enum: [filesystem, s3] }
        checks:
          type: array
          items:
            type: object
            required: [name, outcome]
            additionalProperties: false
            properties:
              name: { type: string, enum: [write, read_back, checksum, delete, anonymous_read_refused] }
              outcome: { type: string, enum: [passed, failed, skipped] }
        errorCode: { type: [string, "null"] }
        durationMs: { type: integer, minimum: 0 }
        testedAt: { $ref: "#/components/schemas/Timestamp" }
    NotificationChannelKind:
      type: string
      enum: [email, enterprise_messaging]
    SmtpInput:
      type: object
      required: [host, port, security, usernameRef, passwordRef, fromAddress]
      additionalProperties: false
      properties:
        host: { type: string, maxLength: 253 }
        port: { type: integer, minimum: 1, maximum: 65535 }
        security: { type: string, enum: [starttls, tls, none] }
        usernameRef: """ + SECRET_REF + """
        passwordRef: """ + SECRET_REF + """
        fromAddress: { type: string, maxLength: 254 }
    NotificationChannel:
      type: object
      required: [organizationId, channelKind, configured, enabled, adapterAvailable, smtp, reason, version, updatedAt]
      additionalProperties: false
      properties:
        organizationId: { $ref: "#/components/schemas/Uuid" }
        channelKind: { $ref: "#/components/schemas/NotificationChannelKind" }
        configured: { type: boolean }
        enabled: { type: boolean }
        adapterAvailable: { type: boolean, description: "False for enterprise_messaging in P6 (port only)." }
        smtp:
          oneOf:
            - $ref: "#/components/schemas/SmtpInput"
            - { type: "null" }
        reason: { type: [string, "null"] }
        version: { type: integer, minimum: 0 }
        updatedAt: { $ref: "#/components/schemas/NullableTimestamp" }
    NotificationChannelPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/NotificationChannel" } }
        nextCursor: { type: [string, "null"] }
    NotificationChannelUpdate:
      type: object
      required: [enabled, smtp, reason]
      additionalProperties: false
      properties:
        enabled: { type: boolean }
        smtp:
          oneOf:
            - $ref: "#/components/schemas/SmtpInput"
            - { type: "null" }
        reason: { type: string, minLength: 3, maxLength: 1000 }
    NotificationChannelTestRequest:
      type: object
      required: [recipient]
      additionalProperties: false
      properties:
        recipient: { type: string, enum: [self] }
    NotificationChannelTestResult:
      type: object
      required: [outcome, channelKind, errorCode, testedAt]
      additionalProperties: false
      properties:
        outcome: { type: string, enum: [sent, failed] }
        channelKind: { $ref: "#/components/schemas/NotificationChannelKind" }
        errorCode: { type: [string, "null"] }
        testedAt: { $ref: "#/components/schemas/Timestamp" }
    NotificationDelivery:
      type: object
      required: [id, notificationId, channelKind, status, attempts, lastAttemptAt, sentAt, skipReason, errorCode, createdAt, version]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        notificationId: { $ref: "#/components/schemas/Uuid" }
        channelKind: { $ref: "#/components/schemas/NotificationChannelKind" }
        status: { type: string, enum: [pending, sent, failed, skipped] }
        attempts: { type: integer, minimum: 0, maximum: 20 }
        lastAttemptAt: { $ref: "#/components/schemas/NullableTimestamp" }
        sentAt: { $ref: "#/components/schemas/NullableTimestamp" }
        skipReason: { type: [string, "null"], enum: [no_address, recipient_restricted, channel_disabled, recipient_disabled, null] }
        errorCode: { type: [string, "null"] }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        version: { type: integer, minimum: 1 }
    NotificationDeliveryPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/NotificationDelivery" } }
        nextCursor: { type: [string, "null"] }
"""

tag = """  - name: operations
    description: Operational exceptions, the worker heartbeat and the service identities of jobs and connectors (P6, ADR-0053).
  - name: platform-admin
    description: Identity, evidence storage and notification channels in Administration (P6, ADR-0054).
"""

# The response-only Permission enum gains the six 0103 codes (additive, as ARCH-01 did for 0100).
_perm_tail = "        - security.read\n    RoleCode:"
assert s.count(_perm_tail) == 1
s = s.replace(_perm_tail, "        - security.read\n        - operations.read\n        - operations.acknowledge\n"
    "        - service_identity.configure\n        - identity.read\n        - storage.configure\n"
    "        - notification_channel.configure\n    RoleCode:", 1)
assert s.count("security:\n  - sessionCookie: []\npaths:\n") == 1
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
