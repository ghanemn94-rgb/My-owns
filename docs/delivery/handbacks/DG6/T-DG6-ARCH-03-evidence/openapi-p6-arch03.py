# T-DG6-ARCH-03: appends the slice B/A operations (ADR-0055, ADR-0056) to docs/api/openapi.yaml as text, so every
# P1-P5, ARCH-01 and ARCH-02 byte stays as it was (only the PermissionCode enum, two tags and appended
# paths/parameters/schemas change; info.version is already 1.5.0-p6).
# Run once from the repository root: python3 docs/delivery/handbacks/DG6/T-DG6-ARCH-03-evidence/openapi-p6-arch03.py
P = "docs/api/openapi.yaml"
s = open(P, encoding="utf-8").read()
assert "version: 1.5.0-p6\n" in s and "operationId: listConnectors" not in s

MUT = """      security:
        - sessionCookie: []
          csrfToken: []
"""
def R(code, comp):
    return f'        "{code}": {{ $ref: "#/components/responses/{comp}" }}\n'
R400, R401, R403, R404 = R(400, "ValidationError"), R(401, "Unauthenticated"), R(403, "Forbidden"), R(404, "NotFound")
R409, R422, R428, R429 = R(409, "VersionConflict"), R(422, "BusinessRule"), R(428, "PreconditionRequired"), R(429, "RateLimited")
READ = R400 + R401 + R403 + R404 + R429
WRITE = R400 + R401 + R403 + R404 + R409 + R422 + R428 + R429
# Actions without If-Match that can still conflict (409 is a business conflict, not the If-Match prologue).
ACTION = R400 + R401 + R403 + R404 + R409 + R422 + R429
CREATE = R400 + R401 + R403 + R404 + R409 + R422 + R429


def problem(code, text):
    return f"""        "{code}":
          description: "{text}"
          content:
            application/problem+json:
              schema: {{ $ref: "#/components/schemas/Problem" }}
"""


def ok(schema, etag=None, status="200", desc="OK.", location=False):
    h = ""
    if etag or location:
        h = "          headers:\n"
        if location:
            h += '            Location: { $ref: "#/components/headers/Location" }\n'
        if etag:
            h += f'            ETag: {{ $ref: "#/components/headers/{etag}" }}\n'
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


def op(method, tag, oid, summary, responses, params="", mutation=False, req=None, security=None):
    out = f"""    {method}:
      tags: [{tag}]
      operationId: {oid}
      summary: "{summary}"
"""
    if security is not None:
        out += security
    elif mutation:
        out += MUT
    if params:
        out += "      parameters:\n" + params
    if req:
        out += req if req.startswith("      requestBody:") else body(req)
    return out + "      responses:\n" + responses


IFM = '        - $ref: "#/components/parameters/IfMatch"\n'
IFZ = '        - $ref: "#/components/parameters/IfMatchOrZero"\n'
IDEM = '        - $ref: "#/components/parameters/IdempotencyKey"\n'
PAGE = '        - $ref: "#/components/parameters/Cursor"\n        - $ref: "#/components/parameters/Limit"\n'
ORGQ = '        - $ref: "#/components/parameters/OrganizationIdQuery"\n'
CONN = '      - $ref: "#/components/parameters/ConnectorId"\n'
TRF = '      - $ref: "#/components/parameters/TransformationId"\n'

# ---------------------------------------------------------------------------------------------- connectors (ADR-0055)
paths = "  /api/v1/admin/connectors:\n" + op(
    "get", "integrations", "listConnectors",
    "Connectors of an organization with their status, verification (verified only after a succeeded test run on the current configuration), last success (derived; null = never succeeded) and newest run (connector.read; ADM_TECH, KDS, TD, TO, AUD). ADR-0055 §1-§2; REQ-S17-001.",
    ok("ConnectorPage") + READ,
    ORGQ + '        - { name: status, in: query, required: false, schema: { $ref: "#/components/schemas/ConnectorStatus" } }\n' + PAGE) + op(
    "post", "integrations", "createConnector",
    "Create a connector, disabled, with configuration version 1 and its connector service identity, in one transaction (connector.configure; ADM_TECH). Credentials are SecretRefs only. Audit connector.created. 409 connector.code_taken; 422 connector.secret_value_refused, connector.mappings_invalid, connector.adapter_settings_invalid, connector.target_invalid. ADR-0055 §1.",
    ok("Connector", "ETag", "201", "Created.", True) + CREATE, "", True, "ConnectorCreate")
paths += "  /api/v1/admin/connectors/{connectorId}:\n    parameters:\n" + CONN + op(
    "get", "integrations", "getConnector",
    "One connector with its current configuration (credential references with whether each resolves, never a value), verification, last success and the newest failed run's actionable error (why, what to do, and the form and import fallbacks). connector.read. ADR-0055 §1, §4; REQ-S17-005.",
    ok("Connector", "ETag") + READ) + op(
    "put", "integrations", "putConnector",
    "Change the names and the configuration; a configuration change is a new configuration version and the connector moves to it (connector.configure; ADM_TECH). Audit connector.updated. 422 as createConnector. ADR-0055 §1.",
    ok("Connector", "ETag") + WRITE, IFM, True, "ConnectorUpdate")
paths += "  /api/v1/admin/connectors/{connectorId}/enable:\n    parameters:\n" + CONN + op(
    "post", "integrations", "enableConnector",
    "Enable a disabled connector (connector.configure; ADM_TECH). Enabling does not verify it; verification needs a succeeded test run. Audit connector.enabled. ADR-0055 §1.",
    ok("Connector", "ETag") + WRITE, IFM, True, "ConnectorEnable")
paths += "  /api/v1/admin/connectors/{connectorId}/disable:\n    parameters:\n" + CONN + op(
    "post", "integrations", "disableConnector",
    "Disable a connector with a reason (connector.configure; ADM_TECH); queued runs are cancelled; forms and imports keep working. Audit connector.disabled. ADR-0055 §1, §4.",
    ok("Connector", "ETag") + WRITE, IFM, True, "ConnectorDisable")
paths += "  /api/v1/admin/connectors/{connectorId}/test:\n    parameters:\n" + CONN + op(
    "post", "integrations", "testConnector",
    "Run a test of the current configuration now: a run with trigger test, the adapter called outside any transaction, nothing committed (connector.configure; ADM_TECH). A succeeded test makes the connector verified for this configuration version. Audit integration_run.*. 409 connector.run_active. ADR-0055 §1-§3.",
    ok("IntegrationRun") + ACTION, "", True, "ConnectorTestRequest")
paths += "  /api/v1/admin/connectors/{connectorId}/mappings:\n    parameters:\n" + CONN + op(
    "get", "integrations", "getConnectorMappings",
    "The field mappings of the current configuration version and the target columns they can map to (the import template of the connector's target). connector.read. ADR-0055 §1; ADR-0056 §9.",
    ok("ConnectorMappings", "ETag") + READ) + op(
    "put", "integrations", "putConnectorMappings",
    "Replace the field mappings: a new configuration version (connector.configure; ADM_TECH). If-Match is the connector's version. Audit connector.mappings_changed. 422 connector.mappings_invalid. ADR-0055 §1.",
    ok("ConnectorMappings", "ETag") + WRITE, IFM, True, "ConnectorMappingsUpdate")
paths += "  /api/v1/admin/connectors/{connectorId}/runs:\n    parameters:\n" + CONN + op(
    "get", "integrations", "listIntegrationRuns",
    "IntegrationRuns of a connector, newest first: trigger, attempt, status, row counts (null = Unknown, never 0), error code, reconciliation (connector.read). ADR-0055 §2; REQ-S17-001, REQ-S16-022.",
    ok("IntegrationRunPage") + READ,
    '        - { name: status, in: query, required: false, schema: { $ref: "#/components/schemas/IntegrationRunStatus" } }\n' + PAGE) + op(
    "post", "integrations", "runConnector",
    "Queue a manual run (connector.run; ADM_TECH, KDS). The same Idempotency-Key returns the existing run with 200. Audit integration_run.queued. 409 connector.disabled, connector.run_active. ADR-0055 §2.",
    ok("IntegrationRun", None, "202", "Accepted (queued).") + ok("IntegrationRun", None, "200", "The existing run for this Idempotency-Key.") + ACTION, IDEM, True, "ConnectorRunRequest")
paths += "  /api/v1/admin/connectors/{connectorId}/runs/{runId}:\n    parameters:\n" + CONN + '      - $ref: "#/components/parameters/IntegrationRunId"\n' + op(
    "get", "integrations", "getIntegrationRun",
    "One IntegrationRun with its status history, its retry chain (retry of, retried by), its staged import batch and, when failed, the actionable error (why, what to do). connector.read. ADR-0055 §2, §4.",
    ok("IntegrationRunDetail", "ETag") + READ)
paths += "  /api/v1/admin/connectors/{connectorId}/runs/{runId}/retry:\n    parameters:\n" + CONN + '      - $ref: "#/components/parameters/IntegrationRunId"\n' + op(
    "post", "integrations", "retryIntegrationRun",
    "Queue the retry of a failed run as its next attempt, once (connector.run; ADM_TECH, KDS). Audit integration_run.queued. 409 integration_run.not_retryable, connector.disabled, connector.run_active; 422 integration_run.retry_limit_reached. ADR-0055 §2.",
    ok("IntegrationRun", None, "202", "Accepted (queued).") + ACTION, "", True, "IntegrationRunRetry")

# ---------------------------------------------------------------------------------------------- imports (ADR-0056)
UPLOAD = """      requestBody:
        required: true
        content:
          text/csv:
            schema: { type: string, contentMediaType: text/csv }
          application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
            schema: { type: string, contentMediaType: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet }
"""
paths += "  /api/v1/transformations/{transformationId}/imports:\n    parameters:\n" + TRF + op(
    "get", "imports", "listImports",
    "Import batches of a transformation, newest first (import.read; KDS, BO, TO, AUD; scoped). Counts are null while staging (Unknown). ADR-0056 §2; REQ-S17-002.",
    ok("ImportBatchPage") + READ,
    '        - { name: status, in: query, required: false, schema: { $ref: "#/components/schemas/ImportBatchStatus" } }\n'
    + '        - { name: sourceKind, in: query, required: false, schema: { $ref: "#/components/schemas/ImportSourceKind" } }\n' + PAGE) + op(
    "post", "imports", "createImport",
    "Upload a CSV (UTF-8) or XLSX file and stage it: parsed with limits (10 MiB, 5,000 rows, XLSX parts and unpacked size), every row validated with the target's rules and the transformation's pinned form schema version, duplicates detected in the file and against committed data, row-level reasons; nothing is committed (import.create; KDS). Audit import_batch.staged. 413 import.file_too_large; 415 import.unsupported_media_type; 422 import.csv_not_utf8, import.xlsx_unsafe, import.too_many_rows, import.header_mismatch, import.template_unknown. ADR-0056 §2-§5; REQ-S17-002, REQ-S17-003.",
    ok("ImportBatch", "ETag", "201", "Staged.", True) + R400 + R401 + R403 + R404 + R422 + R429
    + problem("413", "Larger than 10 MiB (code import.file_too_large).")
    + problem("415", "Not CSV or XLSX (code import.unsupported_media_type)."),
    '        - { name: template, in: query, required: true, schema: { type: string, pattern: "^[a-z][a-z0-9_]*\\\\.v[1-9][0-9]*$", examples: ["kpi_actual.v1"] } }\n'
    + '        - { name: X-File-Name, in: header, required: true, schema: { type: string, minLength: 1, maxLength: 255 } }\n',
    True, UPLOAD)
paths += "  /api/v1/transformations/{transformationId}/imports/{importId}:\n    parameters:\n" + TRF + '      - $ref: "#/components/parameters/ImportId"\n' + op(
    "get", "imports", "getImport",
    "One import batch: source (file name, size and hash; webhook receipt; or connector run), pinned form schema version, status, counts and the commit or cancel record. import.read. ADR-0056 §2.",
    ok("ImportBatch", "ETag") + READ)
paths += "  /api/v1/transformations/{transformationId}/imports/{importId}/rows:\n    parameters:\n" + TRF + '      - $ref: "#/components/parameters/ImportId"\n' + op(
    "get", "imports", "listImportRows",
    "Staged rows in source order with their raw cells (text), validation status, row-level reason codes (rendered in English or Arabic by the client), duplicate pointer, commit status and lineage (the KPI actual a committed row created). import.read. ADR-0056 §5-§6; REQ-S17-002.",
    ok("ImportRowPage") + READ,
    '        - { name: validationStatus, in: query, required: false, schema: { $ref: "#/components/schemas/ImportRowValidationStatus" } }\n' + PAGE)
paths += "  /api/v1/transformations/{transformationId}/imports/{importId}/commit:\n    parameters:\n" + TRF + '      - $ref: "#/components/parameters/ImportId"\n' + op(
    "post", "imports", "commitImport",
    "Commit the valid rows only, in one transaction, each through the target's own path (KPI actuals: the DG4 submission path, never accepted directly), with lineage; invalid and duplicate rows stay visible and uncommitted (import.commit plus kpi_actual.submit, re-checked at commit; KDS). Audit import_batch.committed. 409 import.not_staged, import.revalidation_failed; 422 import.nothing_to_commit. ADR-0056 §6; REQ-S17-002.",
    ok("ImportBatch", "ETag") + WRITE, IFM, True, "ImportCommit")
paths += "  /api/v1/transformations/{transformationId}/imports/{importId}/cancel:\n    parameters:\n" + TRF + '      - $ref: "#/components/parameters/ImportId"\n' + op(
    "post", "imports", "cancelImport",
    "Cancel a staged import with a reason; its rows are kept (import.commit; KDS). Audit import_batch.cancelled. 409 import.not_staged. ADR-0056 §6.",
    ok("ImportBatch", "ETag") + WRITE, IFM, True, "ImportCancel")
paths += "  /api/v1/import-templates:\n" + op(
    "get", "imports", "listImportTemplates",
    "The downloadable import templates (kpi_actual.v1) with their columns (English and Arabic labels, required, kind, example) and media types (import.read). ADR-0056 §9; REQ-S17-003.",
    ok("ImportTemplateList") + R400 + R401 + R403 + R429)
paths += """  /api/v1/import-templates/{templateVersion}/download:
    parameters:
      - $ref: "#/components/parameters/ImportTemplateVersion"
""" + op(
    "get", "imports", "downloadImportTemplate",
    "Download a template as CSV or XLSX, prefilled with one row per active KPI of the transformation the caller can read (empty values) (import.read). ADR-0056 §9.",
    """        "200":
          description: "The template file (attachment)."
          content:
            text/csv:
              schema: { type: string, contentMediaType: text/csv }
            application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
              schema: { type: string, contentMediaType: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet }
""" + READ,
    '        - { name: format, in: query, required: false, schema: { type: string, enum: [csv, xlsx], default: csv } }\n'
    + '        - { name: transformationId, in: query, required: true, schema: { $ref: "#/components/schemas/Uuid" } }\n')

# ---------------------------------------------------------------------------------------------- webhooks (ADR-0056 §7)
WH = '      - $ref: "#/components/parameters/WebhookEndpointId"\n'
paths += "  /api/v1/admin/webhooks:\n" + op(
    "get", "integrations", "listWebhookEndpoints",
    "Webhook endpoints of an organization (connector.read). Secret references only, never a value. ADR-0056 §7.",
    ok("WebhookEndpointPage") + READ, ORGQ + PAGE) + op(
    "post", "integrations", "createWebhookEndpoint",
    "Create an active endpoint for a webhook connector; the server generates the endpoint key; the signing secret is a SecretRef that IT provisions (webhook.configure; ADM_TECH). Audit webhook_endpoint.created. 422 connector.secret_value_refused, webhook.connector_not_webhook. ADR-0056 §7.",
    ok("WebhookEndpoint", "ETag", "201", "Created.", True) + CREATE, "", True, "WebhookEndpointCreate")
paths += "  /api/v1/admin/webhooks/{webhookId}:\n    parameters:\n" + WH + op(
    "get", "integrations", "getWebhookEndpoint",
    "One webhook endpoint with its receive path, secret references, tolerance and newest accepted receipt (connector.read). ADR-0056 §7.",
    ok("WebhookEndpoint", "ETag") + READ)
paths += "  /api/v1/admin/webhooks/{webhookId}/rotate-secret:\n    parameters:\n" + WH + op(
    "post", "integrations", "rotateWebhookSecret",
    "Switch to a new signing SecretRef; the old one stays valid for graceHours (1-168) (webhook.configure; ADM_TECH). Audit webhook_endpoint.secret_rotated. 409 webhook.endpoint_disabled; 422 webhook.grace_invalid, connector.secret_value_refused. ADR-0056 §7.",
    ok("WebhookEndpoint", "ETag") + WRITE, IFM, True, "WebhookSecretRotate")
paths += "  /api/v1/admin/webhooks/{webhookId}/disable:\n    parameters:\n" + WH + op(
    "post", "integrations", "disableWebhookEndpoint",
    "Disable an endpoint with a reason; final (webhook.configure; ADM_TECH). Audit webhook_endpoint.disabled. 409 webhook.endpoint_disabled. ADR-0056 §7.",
    ok("WebhookEndpoint", "ETag") + WRITE, IFM, True, "WebhookDisable")
paths += """  /api/v1/webhooks/{endpointKey}:
    parameters:
      - $ref: "#/components/parameters/WebhookEndpointKey"
""" + op(
    "post", "integrations", "receiveWebhook",
    "Receive a signed webhook delivery and stage it as an import (no session, CSRF-exempt; authenticated by signature). Headers X-MTH-Webhook-Timestamp (Unix seconds), X-MTH-Webhook-Delivery and X-MTH-Webhook-Signature: v1=<hex HMAC-SHA256 of '<timestamp>.<deliveryId>.<raw body>'>, within the endpoint's tolerance (default 300 s). Every authentication failure (unknown or disabled endpoint, missing or bad signature, stale timestamp) is 401 webhook.unauthenticated; an unsigned webhook is rejected. The same delivery id with the same body returns the original result with 200 (replay); with a different body 409 webhook.delivery_id_reused. ADR-0056 §7; REQ-S17-003.",
    ok("WebhookReceiptResult", None, "202", "Accepted and staged.") + ok("WebhookReceiptResult", None, "200", "Replay of an accepted delivery: the original result, nothing new.")
    + R400 + problem("401", "Not signed correctly (code webhook.unauthenticated).") + problem("409", "Delivery id reused with a different body (code webhook.delivery_id_reused).")
    + problem("413", "Body larger than 1 MiB (code webhook.payload_too_large).") + R429,
    '        - { name: X-MTH-Webhook-Timestamp, in: header, required: true, schema: { type: string, pattern: "^[0-9]{1,12}$" } }\n'
    + '        - { name: X-MTH-Webhook-Delivery, in: header, required: true, schema: { type: string, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$" } }\n'
    + '        - { name: X-MTH-Webhook-Signature, in: header, required: true, schema: { type: string, pattern: "^v1=[0-9a-f]{64}$" } }\n',
    False, "WebhookDelivery", "      security: []\n")

# ---------------------------------------------------------------------------------------------- outbound writes (ADR-0055 §5)
OW = '      - $ref: "#/components/parameters/OutboundWriteId"\n'
paths += "  /api/v1/transformations/{transformationId}/outbound-writes:\n    parameters:\n" + TRF + op(
    "get", "integrations", "listOutboundWrites",
    "Outbound writes of a transformation, newest first; 'requested' and 'pending_confirmation' are shown as Pending confirmation, never done (outbound_write.read; TD, KDS, TO, AUD). ADR-0055 §5; REQ-S17-006.",
    ok("OutboundWritePage") + READ,
    '        - { name: status, in: query, required: false, schema: { $ref: "#/components/schemas/OutboundWriteStatus" } }\n'
    + '        - { name: deliverableId, in: query, required: false, schema: { $ref: "#/components/schemas/Uuid" } }\n' + PAGE) + op(
    "post", "integrations", "executeOutboundWrite",
    "Execute a connector-defined downstream write with an explicit idempotency key (outbound_write.execute; TD only by default). The write is recorded first, dispatched outside any transaction with the same key, and marked confirmed only on a confirmed response; otherwise it stays pending_confirmation. The same key and payload returns the existing write with 200 and no second effect. Audit outbound_write.requested and the result. 409 outbound_write.idempotency_key_reused, connector.disabled; 422 outbound_write.action_not_allowed. ADR-0055 §5.",
    ok("OutboundWrite", "ETag", "201", "Created and dispatched.", True) + ok("OutboundWrite", "ETag", "200", "The existing write for this idempotency key (replay; no second effect).") + CREATE,
    "", True, "OutboundWriteExecute")
paths += "  /api/v1/transformations/{transformationId}/outbound-writes/{writeId}:\n    parameters:\n" + TRF + OW + op(
    "get", "integrations", "getOutboundWrite",
    "One outbound write with its status history (outbound_write.read). ADR-0055 §5.",
    ok("OutboundWriteDetail", "ETag") + READ)
paths += "  /api/v1/transformations/{transformationId}/outbound-writes/{writeId}/confirm:\n    parameters:\n" + TRF + OW + op(
    "post", "integrations", "confirmOutboundWrite",
    "Ask the adapter for the outcome of this write's idempotency key (re-dispatching a write left 'requested' with the same key) and record a confirmed response; there is no manual confirmation (outbound_write.execute). A confirmed deliverable_status_push for a flagged deliverable also records the connector confirmation of REQ-S01-005. Audit outbound_write.confirmed or .failed. 409 outbound_write.final. ADR-0055 §5-§6.",
    ok("OutboundWriteDetail", "ETag") + WRITE, IFM, True, "OutboundWriteConfirm")

# ---------------------------------------------------------------------------------------------- deliverable confirmation (ADR-0055 §6)
DLV = '      - $ref: "#/components/parameters/DeliverableId"\n'
paths += "  /api/v1/deliverables/{deliverableId}/confirmation:\n    parameters:\n" + DLV + op(
    "get", "portfolio", "getDeliverableConfirmation",
    "Whether a deliverable is flagged as an external change and its separate confirmation (Unconfirmed; Confirmed by reviewed evidence; Confirmed by connector result) with provenance and history. Task completion and the DG3 acceptance never set it. ETag 0 when the deliverable was never flagged. Scoped read of the deliverable. ADR-0055 §6; REQ-S01-005.",
    ok("DeliverableConfirmation", "ETagOrZero") + READ) + op(
    "post", "portfolio", "confirmDeliverableExternalChange",
    "Confirm a flagged external change with reviewed (verified) evidence of the same transformation; a filename-only link never confirms (external_change.confirm; BO, TD). Audit deliverable_external_change.confirmed. 409 external_change.not_flagged, external_change.already_confirmed; 422 external_change.evidence_not_verified. ADR-0055 §6.",
    ok("DeliverableConfirmation", "ETag") + WRITE, IFM, True, "DeliverableConfirmationRequest")
paths += "  /api/v1/deliverables/{deliverableId}/external-change:\n    parameters:\n" + DLV + op(
    "put", "portfolio", "putDeliverableExternalChange",
    "Flag a deliverable as an external change (customer system, network upgrade, procurement transaction, other), change its type or description, or withdraw the flag while unconfirmed; If-Match 0 creates the flag (external_change.flag; TL, BO, WL, TO). Audit deliverable_external_change.flagged / .changed / .withdrawn. 409 external_change.already_confirmed, external_change.withdraw_confirmed. ADR-0055 §6.",
    ok("DeliverableConfirmation", "ETag") + WRITE, IFZ, True, "DeliverableExternalChangeUpdate")

params = """    ConnectorId:
      name: connectorId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    IntegrationRunId:
      name: runId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    ImportId:
      name: importId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    ImportTemplateVersion:
      name: templateVersion
      in: path
      required: true
      schema: { type: string, pattern: "^[a-z][a-z0-9_]*\\\\.v[1-9][0-9]*$" }
    WebhookEndpointId:
      name: webhookId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
    WebhookEndpointKey:
      name: endpointKey
      in: path
      required: true
      schema: { type: string, pattern: "^[A-Za-z0-9_-]{32,64}$" }
    OutboundWriteId:
      name: writeId
      in: path
      required: true
      schema: { $ref: "#/components/schemas/Uuid" }
"""

NSTR = lambda n: f'{{ type: [string, "null"], maxLength: {n} }}'
NINT = '{ type: [integer, "null"], minimum: 0 }'
NREF = '{ oneOf: [{ $ref: "#/components/schemas/SecretRef" }, { type: "null" }] }'
NDEC = '{ $ref: "#/components/schemas/NullableDecimal" }'
schemas = """    ConnectorAdapterKind:
      type: string
      enum: [test_adapter, webhook, http_pull]
    ConnectorTargetKind:
      type: string
      enum: [kpi_actual, none]
    ConnectorStatus:
      type: string
      enum: [disabled, enabled]
    ConnectorCadence:
      type: string
      enum: [manual, hourly, daily, weekly]
    FieldMapping:
      type: object
      required: [source, target]
      additionalProperties: false
      properties:
        source: { type: string, minLength: 1, maxLength: 100 }
        target: { type: string, pattern: "^[a-z][a-zA-Z0-9_]{0,63}$" }
    CredentialRefView:
      type: object
      required: [provider, name, resolvable]
      additionalProperties: false
      description: "A credential reference and whether the SecretProvider can resolve it now; never the value (ADR-0055 §1)."
      properties:
        provider: { type: string, pattern: "^[a-z][a-z0-9_]{0,31}$" }
        name: { type: string, pattern: "^[A-Za-z_][A-Za-z0-9_./-]{0,127}$" }
        resolvable: { type: [boolean, "null"], description: "null = not checked (Unknown)." }
    ConnectorConfigInput:
      type: object
      required: [sourceSystemId, endpointUrl, credentialRefs, fieldMappings, targetTransformationId, cadence, retryMaxAttempts, retryBackoffSeconds, commitMode, commitOnBehalfOf, outboundActions, reconciliationRule, adapterSettings, reason]
      additionalProperties: false
      properties:
        sourceSystemId: { type: string, minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:/-]*$" }
        endpointUrl: { type: [string, "null"], maxLength: 500, pattern: "^https://" }
        credentialRefs:
          type: object
          maxProperties: 8
          propertyNames: { pattern: "^[a-z][a-z0-9_]{0,31}$" }
          additionalProperties: { $ref: "#/components/schemas/SecretRef" }
        fieldMappings: { type: array, maxItems: 100, items: { $ref: "#/components/schemas/FieldMapping" } }
        targetTransformationId: { $ref: "#/components/schemas/NullableUuid" }
        cadence: { $ref: "#/components/schemas/ConnectorCadence" }
        retryMaxAttempts: { type: integer, minimum: 0, maximum: 5 }
        retryBackoffSeconds: { type: integer, minimum: 10, maximum: 3600 }
        commitMode: { type: string, enum: [manual, auto] }
        commitOnBehalfOf: { $ref: "#/components/schemas/NullableUuid" }
        outboundActions: { type: array, maxItems: 1, uniqueItems: true, items: { type: string, enum: [deliverable_status_push] } }
        reconciliationRule: { type: string, enum: [none, row_count, row_count_and_total] }
        adapterSettings: { type: object, description: "Adapter-specific settings (test adapter: mode healthy | failing | stopped, confirm immediate | never, fixture). Never a secret." }
        reason: { type: string, minLength: 3, maxLength: 1000 }
    ConnectorConfig:
      type: object
      required: [versionNo, sourceSystemId, endpointUrl, credentialRefs, fieldMappings, targetTransformationId, cadence, retryMaxAttempts, retryBackoffSeconds, commitMode, commitOnBehalfOf, outboundActions, reconciliationRule, adapterSettings, reason, createdAt, createdBy]
      additionalProperties: false
      properties:
        versionNo: { type: integer, minimum: 1 }
        sourceSystemId: { type: string }
        endpointUrl: { type: [string, "null"] }
        credentialRefs: { type: object, additionalProperties: { $ref: "#/components/schemas/CredentialRefView" } }
        fieldMappings: { type: array, items: { $ref: "#/components/schemas/FieldMapping" } }
        targetTransformationId: { $ref: "#/components/schemas/NullableUuid" }
        cadence: { $ref: "#/components/schemas/ConnectorCadence" }
        retryMaxAttempts: { type: integer, minimum: 0, maximum: 5 }
        retryBackoffSeconds: { type: integer, minimum: 10, maximum: 3600 }
        commitMode: { type: string, enum: [manual, auto] }
        commitOnBehalfOf: { $ref: "#/components/schemas/NullableUuid" }
        outboundActions: { type: array, items: { type: string, enum: [deliverable_status_push] } }
        reconciliationRule: { type: string, enum: [none, row_count, row_count_and_total] }
        adapterSettings: { type: object }
        reason: { type: string }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/Uuid" }
    ConnectorActionableError:
      type: object
      required: [runId, triggerKind, attemptNo, finishedAt, errorCode, params, fallbacks]
      additionalProperties: false
      description: "The newest failed run: which run, why (errorCode, rendered with its why and what-to-do texts in English or Arabic), and the fallbacks that keep working (REQ-S17-005; ADR-0055 §4)."
      properties:
        runId: { $ref: "#/components/schemas/Uuid" }
        triggerKind: { $ref: "#/components/schemas/IntegrationRunTrigger" }
        attemptNo: { type: integer, minimum: 1 }
        finishedAt: { $ref: "#/components/schemas/Timestamp" }
        errorCode: { type: string, enum: [connector.source_unavailable, connector.stopped, connector.credentials_rejected, connector.secret_unresolvable, connector.mapping_mismatch, connector.response_invalid] }
        params: { type: object, additionalProperties: { type: string } }
        fallbacks: { type: array, items: { type: string, enum: [kpi_form, import_file] } }
    Connector:
      type: object
      required: [id, organizationId, code, nameEn, nameAr, adapterKind, targetKind, status, statusReason, config, verification, lastSuccessAt, lastRun, actionableError, serviceIdentityId, version, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        organizationId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string, pattern: "^[a-z][a-z0-9_-]{1,62}$" }
        nameEn: { type: string, maxLength: 200 }
        nameAr: { type: string, maxLength: 200 }
        adapterKind: { $ref: "#/components/schemas/ConnectorAdapterKind" }
        targetKind: { $ref: "#/components/schemas/ConnectorTargetKind" }
        status: { $ref: "#/components/schemas/ConnectorStatus" }
        statusReason: { type: [string, "null"] }
        config: { $ref: "#/components/schemas/ConnectorConfig" }
        verification: { type: string, enum: [verified, not_verified], description: "verified iff a test run succeeded on the current configuration version; never 'live'." }
        lastSuccessAt: { $ref: "#/components/schemas/NullableTimestamp" }
        lastRun: { oneOf: [{ $ref: "#/components/schemas/IntegrationRun" }, { type: "null" }] }
        actionableError: { oneOf: [{ $ref: "#/components/schemas/ConnectorActionableError" }, { type: "null" }] }
        serviceIdentityId: { $ref: "#/components/schemas/Uuid" }
        version: { type: integer, minimum: 1 }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    ConnectorPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/Connector" } }
        nextCursor: { type: [string, "null"] }
    ConnectorCreate:
      type: object
      required: [organizationId, code, nameEn, nameAr, adapterKind, targetKind, config]
      additionalProperties: false
      properties:
        organizationId: { $ref: "#/components/schemas/Uuid" }
        code: { type: string, pattern: "^[a-z][a-z0-9_-]{1,62}$" }
        nameEn: { type: string, minLength: 1, maxLength: 200 }
        nameAr: { type: string, minLength: 1, maxLength: 200 }
        adapterKind: { $ref: "#/components/schemas/ConnectorAdapterKind" }
        targetKind: { $ref: "#/components/schemas/ConnectorTargetKind" }
        config: { $ref: "#/components/schemas/ConnectorConfigInput" }
    ConnectorUpdate:
      type: object
      required: [nameEn, nameAr, config]
      additionalProperties: false
      properties:
        nameEn: { type: string, minLength: 1, maxLength: 200 }
        nameAr: { type: string, minLength: 1, maxLength: 200 }
        config: { oneOf: [{ $ref: "#/components/schemas/ConnectorConfigInput" }, { type: "null" }], description: "null keeps the current configuration version." }
    ConnectorEnable:
      type: object
      required: [reason]
      additionalProperties: false
      properties:
        reason: { type: [string, "null"], minLength: 3, maxLength: 1000 }
    ConnectorDisable:
      type: object
      required: [reason]
      additionalProperties: false
      properties:
        reason: { type: string, minLength: 3, maxLength: 1000 }
    ConnectorTestRequest:
      type: object
      required: []
      additionalProperties: false
      properties: {}
    ConnectorRunRequest:
      type: object
      required: []
      additionalProperties: false
      properties: {}
    IntegrationRunRetry:
      type: object
      required: []
      additionalProperties: false
      properties: {}
    ConnectorMappings:
      type: object
      required: [connectorId, configVersionNo, fieldMappings, targetColumns]
      additionalProperties: false
      properties:
        connectorId: { $ref: "#/components/schemas/Uuid" }
        configVersionNo: { type: integer, minimum: 1 }
        fieldMappings: { type: array, items: { $ref: "#/components/schemas/FieldMapping" } }
        targetColumns: { type: array, items: { $ref: "#/components/schemas/ImportTemplateColumn" } }
    ConnectorMappingsUpdate:
      type: object
      required: [fieldMappings, reason]
      additionalProperties: false
      properties:
        fieldMappings: { type: array, maxItems: 100, items: { $ref: "#/components/schemas/FieldMapping" } }
        reason: { type: string, minLength: 3, maxLength: 1000 }
    IntegrationRunStatus:
      type: string
      enum: [queued, running, succeeded, failed, cancelled]
    IntegrationRunTrigger:
      type: string
      enum: [schedule, manual, retry, test, webhook]
    IntegrationRun:
      type: object
      required: [id, connectorId, configVersionNo, triggerKind, status, attemptNo, retryOfRunId, idempotencyKey, requestedBy, serviceIdentityId, queuedAt, startedAt, finishedAt, rowsRead, rowsStaged, rowsCommitted, rowsRejected, rowsDuplicate, errorCount, errorCode, errorMessage, reconciliation, importBatchId, version]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        connectorId: { $ref: "#/components/schemas/Uuid" }
        configVersionNo: { type: integer, minimum: 1 }
        triggerKind: { $ref: "#/components/schemas/IntegrationRunTrigger" }
        status: { $ref: "#/components/schemas/IntegrationRunStatus" }
        attemptNo: { type: integer, minimum: 1, maximum: 6 }
        retryOfRunId: { $ref: "#/components/schemas/NullableUuid" }
        idempotencyKey: { type: string }
        requestedBy: { $ref: "#/components/schemas/NullableUuid" }
        serviceIdentityId: { $ref: "#/components/schemas/Uuid" }
        queuedAt: { $ref: "#/components/schemas/Timestamp" }
        startedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        finishedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        rowsRead: """ + NINT + """
        rowsStaged: """ + NINT + """
        rowsCommitted: """ + NINT + """
        rowsRejected: """ + NINT + """
        rowsDuplicate: """ + NINT + """
        errorCount: """ + NINT + """
        errorCode: """ + NSTR(100) + """
        errorMessage: { type: [string, "null"], maxLength: 2000, description: "Redacted before it is stored (ADR-0053 §4)." }
        reconciliation:
          type: object
          required: [status, sourceRowCount, sourceControlTotal, stagedControlTotal]
          additionalProperties: false
          properties:
            status: { type: string, enum: [not_checked, matched, mismatched, not_applicable] }
            sourceRowCount: """ + NINT + """
            sourceControlTotal: """ + NDEC + """
            stagedControlTotal: """ + NDEC + """
        importBatchId: { $ref: "#/components/schemas/NullableUuid" }
        version: { type: integer, minimum: 1 }
    IntegrationRunDetail:
      type: object
      required: [run, retriedByRunId, events, actionableError]
      additionalProperties: false
      properties:
        run: { $ref: "#/components/schemas/IntegrationRun" }
        retriedByRunId: { $ref: "#/components/schemas/NullableUuid" }
        events:
          type: array
          items:
            type: object
            required: [recordVersion, status, rowsRead, rowsStaged, rowsCommitted, rowsRejected, rowsDuplicate, errorCount, errorCode, occurredAt]
            additionalProperties: false
            properties:
              recordVersion: { type: integer, minimum: 1 }
              status: { $ref: "#/components/schemas/IntegrationRunStatus" }
              rowsRead: """ + NINT + """
              rowsStaged: """ + NINT + """
              rowsCommitted: """ + NINT + """
              rowsRejected: """ + NINT + """
              rowsDuplicate: """ + NINT + """
              errorCount: """ + NINT + """
              errorCode: { type: [string, "null"] }
              occurredAt: { $ref: "#/components/schemas/Timestamp" }
        actionableError: { oneOf: [{ $ref: "#/components/schemas/ConnectorActionableError" }, { type: "null" }] }
    IntegrationRunPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/IntegrationRun" } }
        nextCursor: { type: [string, "null"] }
    ImportBatchStatus:
      type: string
      enum: [staging, staged, committed, cancelled, failed]
    ImportSourceKind:
      type: string
      enum: [csv_upload, xlsx_upload, webhook, connector]
    ImportRowValidationStatus:
      type: string
      enum: [valid, invalid, duplicate_in_batch, duplicate_committed]
    ImportBatch:
      type: object
      required: [id, transformationId, targetKind, templateVersion, formSchemaVersionId, sourceKind, connectorId, integrationRunId, webhookReceiptId, fileName, mediaType, byteSize, contentSha256, status, rowsTotal, rowsValid, rowsInvalid, rowsDuplicate, rowsCommitted, failureCode, commitMode, onBehalfOfUserId, committedAt, committedBy, cancelledAt, cancelledBy, cancelReason, createdAt, createdBy, version]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        targetKind: { type: string, enum: [kpi_actual] }
        templateVersion: { type: string }
        formSchemaVersionId: { $ref: "#/components/schemas/Uuid" }
        sourceKind: { $ref: "#/components/schemas/ImportSourceKind" }
        connectorId: { $ref: "#/components/schemas/NullableUuid" }
        integrationRunId: { $ref: "#/components/schemas/NullableUuid" }
        webhookReceiptId: { $ref: "#/components/schemas/NullableUuid" }
        fileName: { type: [string, "null"], maxLength: 255 }
        mediaType: { type: [string, "null"], enum: [text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json, null] }
        byteSize: { type: [integer, "null"], minimum: 1, maximum: 10485760 }
        contentSha256: { type: [string, "null"], pattern: "^[0-9a-f]{64}$" }
        status: { $ref: "#/components/schemas/ImportBatchStatus" }
        rowsTotal: { type: [integer, "null"], minimum: 0, maximum: 5000, description: "null while staging (Unknown, never 0)." }
        rowsValid: """ + NINT + """
        rowsInvalid: """ + NINT + """
        rowsDuplicate: """ + NINT + """
        rowsCommitted: """ + NINT + """
        failureCode: """ + NSTR(100) + """
        commitMode: { type: string, enum: [manual, auto] }
        onBehalfOfUserId: { $ref: "#/components/schemas/NullableUuid" }
        committedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        committedBy: { $ref: "#/components/schemas/NullableUuid" }
        cancelledAt: { $ref: "#/components/schemas/NullableTimestamp" }
        cancelledBy: { $ref: "#/components/schemas/NullableUuid" }
        cancelReason: { type: [string, "null"] }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        createdBy: { $ref: "#/components/schemas/NullableUuid" }
        version: { type: integer, minimum: 1 }
    ImportBatchPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/ImportBatch" } }
        nextCursor: { type: [string, "null"] }
    ImportRowReason:
      type: object
      required: [code, field, params]
      additionalProperties: false
      description: "A row-level reason; the client renders the code's English or Arabic text with the params (ADR-0056 §5)."
      properties:
        code: { type: string, pattern: "^import\\\\.row\\\\.[a-z_]+$" }
        field: { type: [string, "null"] }
        params: { type: object, additionalProperties: { type: [string, integer] } }
    ImportRow:
      type: object
      required: [id, rowNumber, sourceRecordId, raw, normalized, duplicateKey, validationStatus, duplicateOfRowNumber, reasons, commitStatus, lineage]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        rowNumber: { type: integer, minimum: 1 }
        sourceRecordId: { type: [string, "null"], maxLength: 200 }
        raw: { type: object, additionalProperties: { type: [string, "null"] }, description: "The source cells as text (never a number parsed from a spreadsheet double)." }
        normalized: { type: [object, "null"], additionalProperties: { type: [string, "null"] }, description: "Normalized values (decimal strings); set for valid rows only." }
        duplicateKey: { type: [string, "null"] }
        validationStatus: { $ref: "#/components/schemas/ImportRowValidationStatus" }
        duplicateOfRowNumber: { type: [integer, "null"], minimum: 1 }
        reasons: { type: array, maxItems: 20, items: { $ref: "#/components/schemas/ImportRowReason" } }
        commitStatus: { type: string, enum: [pending, committed, not_committed] }
        lineage:
          oneOf:
            - type: object
              required: [targetRecordType, targetRecordId, targetValueNo, committedAt]
              additionalProperties: false
              properties:
                targetRecordType: { type: string, enum: [kpi_actual] }
                targetRecordId: { $ref: "#/components/schemas/Uuid" }
                targetValueNo: { type: integer, minimum: 1 }
                committedAt: { $ref: "#/components/schemas/Timestamp" }
            - { type: "null" }
    ImportRowPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/ImportRow" } }
        nextCursor: { type: [string, "null"] }
    ImportCommit:
      type: object
      required: [note]
      additionalProperties: false
      properties:
        note: { type: [string, "null"], minLength: 3, maxLength: 1000 }
    ImportCancel:
      type: object
      required: [reason]
      additionalProperties: false
      properties:
        reason: { type: string, minLength: 3, maxLength: 1000 }
    ImportTemplateColumn:
      type: object
      required: [key, labelEn, labelAr, required, kind, example]
      additionalProperties: false
      properties:
        key: { type: string, pattern: "^[a-z][a-z0-9_]{0,63}$" }
        labelEn: { type: string }
        labelAr: { type: string }
        required: { type: boolean }
        kind: { type: string, enum: [text, uuid, decimal, date, boolean, enum] }
        example: { type: [string, "null"] }
    ImportTemplate:
      type: object
      required: [templateVersion, targetKind, titleEn, titleAr, mediaTypes, columns]
      additionalProperties: false
      properties:
        templateVersion: { type: string }
        targetKind: { type: string, enum: [kpi_actual] }
        titleEn: { type: string }
        titleAr: { type: string }
        mediaTypes: { type: array, items: { type: string, enum: [text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet] } }
        columns: { type: array, items: { $ref: "#/components/schemas/ImportTemplateColumn" } }
    ImportTemplateList:
      type: object
      required: [items]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/ImportTemplate" } }
    WebhookEndpoint:
      type: object
      required: [id, organizationId, connectorId, endpointKey, receivePath, label, signingSecretRef, previousSecretRef, previousValidUntil, secretRotatedAt, toleranceSeconds, status, disabledAt, disabledBy, disableReason, lastReceiptAt, version, updatedAt]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        organizationId: { $ref: "#/components/schemas/Uuid" }
        connectorId: { $ref: "#/components/schemas/Uuid" }
        endpointKey: { type: string, pattern: "^[A-Za-z0-9_-]{32,64}$" }
        receivePath: { type: string, description: "/api/v1/webhooks/{endpointKey}" }
        label: { type: string, maxLength: 200 }
        signingSecretRef: { $ref: "#/components/schemas/SecretRef" }
        previousSecretRef: """ + NREF + """
        previousValidUntil: { $ref: "#/components/schemas/NullableTimestamp" }
        secretRotatedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        toleranceSeconds: { type: integer, minimum: 30, maximum: 900 }
        status: { type: string, enum: [active, disabled] }
        disabledAt: { $ref: "#/components/schemas/NullableTimestamp" }
        disabledBy: { $ref: "#/components/schemas/NullableUuid" }
        disableReason: { type: [string, "null"] }
        lastReceiptAt: { $ref: "#/components/schemas/NullableTimestamp" }
        version: { type: integer, minimum: 1 }
        updatedAt: { $ref: "#/components/schemas/Timestamp" }
    WebhookEndpointPage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/WebhookEndpoint" } }
        nextCursor: { type: [string, "null"] }
    WebhookEndpointCreate:
      type: object
      required: [connectorId, label, signingSecretRef, toleranceSeconds]
      additionalProperties: false
      properties:
        connectorId: { $ref: "#/components/schemas/Uuid" }
        label: { type: string, minLength: 1, maxLength: 200 }
        signingSecretRef: { $ref: "#/components/schemas/SecretRef" }
        toleranceSeconds: { type: integer, minimum: 30, maximum: 900 }
    WebhookSecretRotate:
      type: object
      required: [signingSecretRef, graceHours, reason]
      additionalProperties: false
      properties:
        signingSecretRef: { $ref: "#/components/schemas/SecretRef" }
        graceHours: { type: integer, minimum: 1, maximum: 168 }
        reason: { type: string, minLength: 3, maxLength: 1000 }
    WebhookDisable:
      type: object
      required: [reason]
      additionalProperties: false
      properties:
        reason: { type: string, minLength: 3, maxLength: 1000 }
    WebhookDelivery:
      type: object
      required: [templateVersion, items]
      additionalProperties: false
      description: "The signed body (≤ 1 MiB, strict UTF-8). Every item value is a JSON string; a decimal is sent as a string (ADR-0056 §7)."
      properties:
        templateVersion: { type: string, pattern: "^[a-z][a-z0-9_]*\\\\.v[1-9][0-9]*$" }
        items:
          type: array
          maxItems: 5000
          items: { type: object, maxProperties: 50, additionalProperties: { type: [string, "null"], maxLength: 4000 } }
    WebhookReceiptResult:
      type: object
      required: [receiptId, importBatchId, replay, rowsTotal, rowsValid, rowsInvalid, rowsDuplicate]
      additionalProperties: false
      properties:
        receiptId: { $ref: "#/components/schemas/Uuid" }
        importBatchId: { $ref: "#/components/schemas/Uuid" }
        replay: { type: boolean }
        rowsTotal: { type: integer, minimum: 0 }
        rowsValid: { type: integer, minimum: 0 }
        rowsInvalid: { type: integer, minimum: 0 }
        rowsDuplicate: { type: integer, minimum: 0 }
    OutboundWriteStatus:
      type: string
      enum: [requested, pending_confirmation, confirmed, failed]
    OutboundWrite:
      type: object
      required: [id, transformationId, connectorId, configVersionNo, actionCode, deliverableId, idempotencyKey, payload, payloadSha256, status, attemptCount, lastAttemptAt, externalReference, confirmedAt, failureCode, failureMessage, requestedBy, createdAt, version]
      additionalProperties: false
      properties:
        id: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        connectorId: { $ref: "#/components/schemas/Uuid" }
        configVersionNo: { type: integer, minimum: 1 }
        actionCode: { type: string, enum: [deliverable_status_push] }
        deliverableId: { $ref: "#/components/schemas/Uuid" }
        idempotencyKey: { type: string }
        payload: { type: object }
        payloadSha256: { type: string, pattern: "^[0-9a-f]{64}$" }
        status: { $ref: "#/components/schemas/OutboundWriteStatus" }
        attemptCount: { type: integer, minimum: 0, maximum: 10 }
        lastAttemptAt: { $ref: "#/components/schemas/NullableTimestamp" }
        externalReference: { type: [string, "null"], maxLength: 200 }
        confirmedAt: { $ref: "#/components/schemas/NullableTimestamp" }
        failureCode: { type: [string, "null"] }
        failureMessage: { type: [string, "null"] }
        requestedBy: { $ref: "#/components/schemas/Uuid" }
        createdAt: { $ref: "#/components/schemas/Timestamp" }
        version: { type: integer, minimum: 1 }
    OutboundWriteDetail:
      type: object
      required: [write, events]
      additionalProperties: false
      properties:
        write: { $ref: "#/components/schemas/OutboundWrite" }
        events:
          type: array
          items:
            type: object
            required: [recordVersion, status, attemptCount, externalReference, failureCode, actorUserId, occurredAt]
            additionalProperties: false
            properties:
              recordVersion: { type: integer, minimum: 1 }
              status: { $ref: "#/components/schemas/OutboundWriteStatus" }
              attemptCount: { type: integer, minimum: 0 }
              externalReference: { type: [string, "null"] }
              failureCode: { type: [string, "null"] }
              actorUserId: { $ref: "#/components/schemas/NullableUuid" }
              occurredAt: { $ref: "#/components/schemas/Timestamp" }
    OutboundWritePage:
      type: object
      required: [items, nextCursor]
      additionalProperties: false
      properties:
        items: { type: array, items: { $ref: "#/components/schemas/OutboundWrite" } }
        nextCursor: { type: [string, "null"] }
    OutboundWriteExecute:
      type: object
      required: [connectorId, actionCode, deliverableId, idempotencyKey, payload]
      additionalProperties: false
      properties:
        connectorId: { $ref: "#/components/schemas/Uuid" }
        actionCode: { type: string, enum: [deliverable_status_push] }
        deliverableId: { $ref: "#/components/schemas/Uuid" }
        idempotencyKey: { type: string, minLength: 8, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$" }
        payload: { type: object, description: "At most 16 KiB; never a secret." }
    OutboundWriteConfirm:
      type: object
      required: []
      additionalProperties: false
      properties: {}
    ExternalChangeType:
      type: string
      enum: [customer_system, network_upgrade, procurement_transaction, other]
    DeliverableConfirmation:
      type: object
      required: [deliverableId, transformationId, externalChange]
      additionalProperties: false
      properties:
        deliverableId: { $ref: "#/components/schemas/Uuid" }
        transformationId: { $ref: "#/components/schemas/Uuid" }
        externalChange:
          description: "null = the deliverable was never flagged as an external change."
          oneOf:
            - type: object
              required: [id, isExternalChange, changeType, description, confirmationStatus, confirmationSource, evidenceId, outboundWriteId, connectorId, sourceSystemId, sourceReference, sourceConfirmedAt, serviceIdentityId, confirmedAt, confirmedBy, confirmationNote, version, events]
              additionalProperties: false
              properties:
                id: { $ref: "#/components/schemas/Uuid" }
                isExternalChange: { type: boolean }
                changeType: { $ref: "#/components/schemas/ExternalChangeType" }
                description: { type: [string, "null"], maxLength: 2000 }
                confirmationStatus: { type: string, enum: [unconfirmed, confirmed] }
                confirmationSource: { type: [string, "null"], enum: [reviewed_evidence, connector_result, null] }
                evidenceId: { $ref: "#/components/schemas/NullableUuid" }
                outboundWriteId: { $ref: "#/components/schemas/NullableUuid" }
                connectorId: { $ref: "#/components/schemas/NullableUuid" }
                sourceSystemId: { type: [string, "null"] }
                sourceReference: { type: [string, "null"] }
                sourceConfirmedAt: { $ref: "#/components/schemas/NullableTimestamp" }
                serviceIdentityId: { $ref: "#/components/schemas/NullableUuid" }
                confirmedAt: { $ref: "#/components/schemas/NullableTimestamp" }
                confirmedBy: { $ref: "#/components/schemas/NullableUuid" }
                confirmationNote: { type: [string, "null"] }
                version: { type: integer, minimum: 1 }
                events:
                  type: array
                  items:
                    type: object
                    required: [recordVersion, isExternalChange, changeType, confirmationStatus, confirmationSource, actorUserId, occurredAt]
                    additionalProperties: false
                    properties:
                      recordVersion: { type: integer, minimum: 1 }
                      isExternalChange: { type: boolean }
                      changeType: { $ref: "#/components/schemas/ExternalChangeType" }
                      confirmationStatus: { type: string, enum: [unconfirmed, confirmed] }
                      confirmationSource: { type: [string, "null"] }
                      actorUserId: { $ref: "#/components/schemas/NullableUuid" }
                      occurredAt: { $ref: "#/components/schemas/Timestamp" }
            - { type: "null" }
    DeliverableExternalChangeUpdate:
      type: object
      required: [isExternalChange, changeType, description]
      additionalProperties: false
      properties:
        isExternalChange: { type: boolean, description: "false withdraws the flag (only while unconfirmed)." }
        changeType: { $ref: "#/components/schemas/ExternalChangeType" }
        description: { type: [string, "null"], minLength: 1, maxLength: 2000 }
    DeliverableConfirmationRequest:
      type: object
      required: [evidenceId, note]
      additionalProperties: false
      properties:
        evidenceId: { $ref: "#/components/schemas/Uuid" }
        note: { type: [string, "null"], minLength: 3, maxLength: 2000 }
"""

tag = """  - name: integrations
    description: Connectors, integration runs, webhooks and guarded outbound writes (P6, ADR-0055, ADR-0056 §7).
  - name: imports
    description: Staged CSV/XLSX imports, row-level validation, commit with lineage and templates (P6, ADR-0056).
"""

_perm_tail = "        - notification_channel.configure\n    RoleCode:"
assert s.count(_perm_tail) == 1
s = s.replace(_perm_tail, "        - notification_channel.configure\n"
    "        - connector.read\n        - connector.configure\n        - connector.run\n        - webhook.configure\n"
    "        - import.read\n        - import.create\n        - import.commit\n        - outbound_write.read\n"
    "        - outbound_write.execute\n        - external_change.flag\n        - external_change.confirm\n    RoleCode:", 1)
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
