// Administration > Integrations: the request paths, types, query keys and read hooks of the connector, run, mapping,
// webhook-endpoint and outbound-write operations (T-DG6-FE-C; p6-work-split §B/A.9; ADR-0055 §1-§5, ADR-0056 §7;
// docs/api/openapi.yaml tags integrations). The types are written from the contract (the OpenAPI file is the source of
// truth); FE tasks keep their hooks here and never edit `api/**` (api/p6.ts header).
//
// Unknown is data, never a default (ADR-0055 §10; p6-work-split §2 rule 5, §B/A.13 item 5): a null row count is
// rendered "Unknown", a null last success "Never succeeded", a reconciliation that was not checked "Not checked", and a
// connector is "Not verified" until a test run succeeds on its current configuration. Nothing here turns null into 0.
// Nothing is "live": the test adapter is the only exercised source (§B/A.13 item 9).
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { shouldRetry } from "../../api/queries.ts";

const v1 = "/api/v1";
const seg = (s: string) => encodeURIComponent(s);

// ------------------------------------------------------------------------------------------------ types (contract)

export type ConnectorAdapterKind = "test_adapter" | "webhook" | "http_pull";
export type ConnectorTargetKind = "kpi_actual" | "none";
export type ConnectorStatus = "disabled" | "enabled";
export type ConnectorCadence = "manual" | "hourly" | "daily" | "weekly";
export type IntegrationRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type IntegrationRunTrigger = "schedule" | "manual" | "retry" | "test" | "webhook";
export type ReconciliationStatus = "not_checked" | "matched" | "mismatched" | "not_applicable";
export type OutboundWriteStatus = "requested" | "pending_confirmation" | "confirmed" | "failed";

export const CONNECTOR_ADAPTER_KINDS: readonly ConnectorAdapterKind[] = ["test_adapter", "webhook", "http_pull"];
export const CONNECTOR_CADENCES: readonly ConnectorCadence[] = ["manual", "hourly", "daily", "weekly"];
export const INTEGRATION_RUN_STATUSES: readonly IntegrationRunStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];
export const OUTBOUND_WRITE_STATUSES: readonly OutboundWriteStatus[] = [
  "requested",
  "pending_confirmation",
  "confirmed",
  "failed",
];
/** The six actionable error codes of ADR-0055 §4 (`ConnectorActionableError.errorCode`). */
export const ACTIONABLE_ERROR_CODES = [
  "connector.source_unavailable",
  "connector.stopped",
  "connector.credentials_rejected",
  "connector.secret_unresolvable",
  "connector.mapping_mismatch",
  "connector.response_invalid",
] as const;
export type ActionableErrorCode = (typeof ACTIONABLE_ERROR_CODES)[number];

export interface SecretRef {
  readonly provider: string;
  readonly name: string;
}
/** A credential reference and whether it resolves now (null = not checked, Unknown); never the value. */
export interface CredentialRefView extends SecretRef {
  readonly resolvable: boolean | null;
}
export interface FieldMapping {
  readonly source: string;
  readonly target: string;
}

export interface ConnectorConfig {
  readonly versionNo: number;
  readonly sourceSystemId: string;
  readonly endpointUrl: string | null;
  readonly credentialRefs: Readonly<Record<string, CredentialRefView>>;
  readonly fieldMappings: readonly FieldMapping[];
  readonly targetTransformationId: string | null;
  readonly cadence: ConnectorCadence;
  readonly retryMaxAttempts: number;
  readonly retryBackoffSeconds: number;
  readonly commitMode: "manual" | "auto";
  readonly commitOnBehalfOf: string | null;
  readonly outboundActions: readonly "deliverable_status_push"[];
  readonly reconciliationRule: "none" | "row_count" | "row_count_and_total";
  readonly adapterSettings: Readonly<Record<string, unknown>>;
  readonly reason: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface ConnectorConfigInput {
  sourceSystemId: string;
  endpointUrl: string | null;
  credentialRefs: Record<string, SecretRef>;
  fieldMappings: FieldMapping[];
  targetTransformationId: string | null;
  cadence: ConnectorCadence;
  retryMaxAttempts: number;
  retryBackoffSeconds: number;
  commitMode: "manual" | "auto";
  commitOnBehalfOf: string | null;
  outboundActions: "deliverable_status_push"[];
  reconciliationRule: "none" | "row_count" | "row_count_and_total";
  adapterSettings: Record<string, unknown>;
  reason: string;
}

export interface ActionableError {
  readonly runId: string;
  readonly triggerKind: IntegrationRunTrigger;
  readonly attemptNo: number;
  readonly finishedAt: string;
  readonly errorCode: ActionableErrorCode;
  readonly params: Readonly<Record<string, string>>;
  readonly fallbacks: readonly ("kpi_form" | "import_file")[];
}

export interface IntegrationRun {
  readonly id: string;
  readonly connectorId: string;
  readonly configVersionNo: number;
  readonly triggerKind: IntegrationRunTrigger;
  readonly status: IntegrationRunStatus;
  readonly attemptNo: number;
  readonly retryOfRunId: string | null;
  readonly idempotencyKey: string;
  readonly requestedBy: string | null;
  readonly serviceIdentityId: string;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly rowsRead: number | null;
  readonly rowsStaged: number | null;
  readonly rowsCommitted: number | null;
  readonly rowsRejected: number | null;
  readonly rowsDuplicate: number | null;
  readonly errorCount: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly reconciliation: {
    readonly status: ReconciliationStatus;
    readonly sourceRowCount: number | null;
    readonly sourceControlTotal: string | null;
    readonly stagedControlTotal: string | null;
  };
  readonly importBatchId: string | null;
  readonly version: number;
}

export interface IntegrationRunEvent {
  readonly recordVersion: number;
  readonly status: IntegrationRunStatus;
  readonly rowsRead: number | null;
  readonly rowsStaged: number | null;
  readonly rowsCommitted: number | null;
  readonly rowsRejected: number | null;
  readonly rowsDuplicate: number | null;
  readonly errorCount: number | null;
  readonly errorCode: string | null;
  readonly occurredAt: string;
}

export interface IntegrationRunDetail {
  readonly run: IntegrationRun;
  readonly retriedByRunId: string | null;
  readonly events: readonly IntegrationRunEvent[];
  readonly actionableError: ActionableError | null;
}

export interface Connector {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly adapterKind: ConnectorAdapterKind;
  readonly targetKind: ConnectorTargetKind;
  readonly status: ConnectorStatus;
  readonly statusReason: string | null;
  readonly config: ConnectorConfig;
  readonly verification: "verified" | "not_verified";
  readonly lastSuccessAt: string | null;
  readonly lastRun: IntegrationRun | null;
  readonly actionableError: ActionableError | null;
  readonly serviceIdentityId: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ImportTemplateColumn {
  readonly key: string;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly required: boolean;
  readonly kind: "text" | "uuid" | "decimal" | "date" | "boolean" | "enum";
  readonly example: string | null;
}

export interface ConnectorMappings {
  readonly connectorId: string;
  readonly configVersionNo: number;
  readonly fieldMappings: readonly FieldMapping[];
  readonly targetColumns: readonly ImportTemplateColumn[];
}

export interface WebhookEndpoint {
  readonly id: string;
  readonly organizationId: string;
  readonly connectorId: string;
  readonly endpointKey: string;
  readonly receivePath: string;
  readonly label: string;
  readonly signingSecretRef: SecretRef;
  readonly previousSecretRef: SecretRef | null;
  readonly previousValidUntil: string | null;
  readonly secretRotatedAt: string | null;
  readonly toleranceSeconds: number;
  readonly status: "active" | "disabled";
  readonly disabledAt: string | null;
  readonly disabledBy: string | null;
  readonly disableReason: string | null;
  readonly lastReceiptAt: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

export interface OutboundWrite {
  readonly id: string;
  readonly transformationId: string;
  readonly connectorId: string;
  readonly configVersionNo: number;
  readonly actionCode: "deliverable_status_push";
  readonly deliverableId: string;
  readonly idempotencyKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadSha256: string;
  readonly status: OutboundWriteStatus;
  readonly attemptCount: number;
  readonly lastAttemptAt: string | null;
  readonly externalReference: string | null;
  readonly confirmedAt: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly requestedBy: string;
  readonly createdAt: string;
  readonly version: number;
}

export interface OutboundWriteDetail {
  readonly write: OutboundWrite;
  readonly events: readonly {
    readonly recordVersion: number;
    readonly status: OutboundWriteStatus;
    readonly attemptCount: number;
    readonly externalReference: string | null;
    readonly failureCode: string | null;
    readonly actorUserId: string | null;
    readonly occurredAt: string;
  }[];
}

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/**
 * The display state of an outbound write: "requested" and "pending_confirmation" are both "Pending confirmation",
 * never done (ADR-0055 §5; the `listOutboundWrites` contract text). Only a confirmed response is "Confirmed".
 */
export function outboundDisplayStatus(status: OutboundWriteStatus): "pending_confirmation" | "confirmed" | "failed" {
  return status === "confirmed" ? "confirmed" : status === "failed" ? "failed" : "pending_confirmation";
}

// ------------------------------------------------------------------------------------------------ paths

const connectorBase = (connectorId: string) => `${v1}/admin/connectors/${seg(connectorId)}`;
const webhookBase = (webhookId: string) => `${v1}/admin/webhooks/${seg(webhookId)}`;
const outboundBase = (tid: string) => `${v1}/transformations/${seg(tid)}/outbound-writes`;

export const integrationPaths = {
  connectors: `${v1}/admin/connectors`, // listConnectors, createConnector
  connector: connectorBase, // getConnector, putConnector
  enable: (id: string) => `${connectorBase(id)}/enable`, // enableConnector
  disable: (id: string) => `${connectorBase(id)}/disable`, // disableConnector
  test: (id: string) => `${connectorBase(id)}/test`, // testConnector
  mappings: (id: string) => `${connectorBase(id)}/mappings`, // getConnectorMappings, putConnectorMappings
  runs: (id: string) => `${connectorBase(id)}/runs`, // listIntegrationRuns, runConnector
  run: (id: string, runId: string) => `${connectorBase(id)}/runs/${seg(runId)}`, // getIntegrationRun
  retry: (id: string, runId: string) => `${connectorBase(id)}/runs/${seg(runId)}/retry`, // retryIntegrationRun
  webhooks: `${v1}/admin/webhooks`, // listWebhookEndpoints, createWebhookEndpoint
  webhook: webhookBase, // getWebhookEndpoint
  rotateWebhookSecret: (id: string) => `${webhookBase(id)}/rotate-secret`, // rotateWebhookSecret
  disableWebhook: (id: string) => `${webhookBase(id)}/disable`, // disableWebhookEndpoint
  outboundWrites: outboundBase, // listOutboundWrites, executeOutboundWrite
  outboundWrite: (tid: string, writeId: string) => `${outboundBase(tid)}/${seg(writeId)}`, // getOutboundWrite
  confirmOutboundWrite: (tid: string, writeId: string) => `${outboundBase(tid)}/${seg(writeId)}/confirm`, // confirmOutboundWrite
};

/** The operations this module sends, as (operationId, method, path template); checked against the contract by a test. */
export const INTEGRATION_OPERATIONS: readonly (readonly [string, "GET" | "PUT" | "POST", string])[] = [
  ["listConnectors", "GET", "/api/v1/admin/connectors"],
  ["createConnector", "POST", "/api/v1/admin/connectors"],
  ["getConnector", "GET", "/api/v1/admin/connectors/{connectorId}"],
  ["putConnector", "PUT", "/api/v1/admin/connectors/{connectorId}"],
  ["enableConnector", "POST", "/api/v1/admin/connectors/{connectorId}/enable"],
  ["disableConnector", "POST", "/api/v1/admin/connectors/{connectorId}/disable"],
  ["testConnector", "POST", "/api/v1/admin/connectors/{connectorId}/test"],
  ["getConnectorMappings", "GET", "/api/v1/admin/connectors/{connectorId}/mappings"],
  ["putConnectorMappings", "PUT", "/api/v1/admin/connectors/{connectorId}/mappings"],
  ["listIntegrationRuns", "GET", "/api/v1/admin/connectors/{connectorId}/runs"],
  ["runConnector", "POST", "/api/v1/admin/connectors/{connectorId}/runs"],
  ["getIntegrationRun", "GET", "/api/v1/admin/connectors/{connectorId}/runs/{runId}"],
  ["retryIntegrationRun", "POST", "/api/v1/admin/connectors/{connectorId}/runs/{runId}/retry"],
  ["listWebhookEndpoints", "GET", "/api/v1/admin/webhooks"],
  ["createWebhookEndpoint", "POST", "/api/v1/admin/webhooks"],
  ["getWebhookEndpoint", "GET", "/api/v1/admin/webhooks/{webhookId}"],
  ["rotateWebhookSecret", "POST", "/api/v1/admin/webhooks/{webhookId}/rotate-secret"],
  ["disableWebhookEndpoint", "POST", "/api/v1/admin/webhooks/{webhookId}/disable"],
  ["listOutboundWrites", "GET", "/api/v1/transformations/{transformationId}/outbound-writes"],
  ["getOutboundWrite", "GET", "/api/v1/transformations/{transformationId}/outbound-writes/{writeId}"],
  ["confirmOutboundWrite", "POST", "/api/v1/transformations/{transformationId}/outbound-writes/{writeId}/confirm"],
];

// ------------------------------------------------------------------------------------------------ query keys

export const integrationKeys = {
  all: ["p6", "integrations"] as const,
  connectors: (query: Record<string, string>) => ["p6", "integrations", "connectors", query] as const,
  connector: (id: string) => ["p6", "integrations", "connector", id] as const,
  mappings: (id: string) => ["p6", "integrations", "connector", id, "mappings"] as const,
  runs: (id: string, query: Record<string, string>) => ["p6", "integrations", "connector", id, "runs", query] as const,
  run: (id: string, runId: string) => ["p6", "integrations", "connector", id, "run", runId] as const,
  webhooks: (query: Record<string, string>) => ["p6", "integrations", "webhooks", query] as const,
  webhook: (id: string) => ["p6", "integrations", "webhook", id] as const,
  outboundWrites: (tid: string, query: Record<string, string>) =>
    ["p6", "integrations", "outbound", tid, query] as const,
  outboundWrite: (tid: string, writeId: string) => ["p6", "integrations", "outbound", tid, "write", writeId] as const,
};

/** Refreshes every integrations read after a write (connector, runs, mappings, webhooks, outbound writes). */
export function useIntegrationsRefresh(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: integrationKeys.all });
}

// ------------------------------------------------------------------------------------------------ read hooks

const page = <T>(path: string, query: Record<string, string>, cursor: string | null) =>
  api.get<Page<T>>(path, { ...query, ...(cursor ? { cursor } : {}) });

export function useConnectors(query: Record<string, string>, cursor: string | null) {
  return useQuery({
    queryKey: [...integrationKeys.connectors(query), cursor ?? ""],
    queryFn: () => page<Connector>(integrationPaths.connectors, query, cursor),
    enabled: Boolean(query["organizationId"]),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useConnector(id: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.connector(id ?? ""),
    queryFn: () => api.get<Connector>(integrationPaths.connector(id ?? "")),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}
export function useConnectorMappings(id: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.mappings(id ?? ""),
    queryFn: () => api.get<ConnectorMappings>(integrationPaths.mappings(id ?? "")),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}
export function useIntegrationRuns(id: string | undefined, query: Record<string, string>, cursor: string | null) {
  return useQuery({
    queryKey: [...integrationKeys.runs(id ?? "", query), cursor ?? ""],
    queryFn: () => page<IntegrationRun>(integrationPaths.runs(id ?? ""), query, cursor),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useIntegrationRun(id: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.run(id ?? "", runId ?? ""),
    queryFn: () => api.get<IntegrationRunDetail>(integrationPaths.run(id ?? "", runId ?? "")),
    enabled: Boolean(id && runId),
    retry: shouldRetry,
  });
}
export function useWebhookEndpoints(query: Record<string, string>, cursor: string | null) {
  return useQuery({
    queryKey: [...integrationKeys.webhooks(query), cursor ?? ""],
    queryFn: () => page<WebhookEndpoint>(integrationPaths.webhooks, query, cursor),
    enabled: Boolean(query["organizationId"]),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useWebhookEndpoint(id: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.webhook(id ?? ""),
    queryFn: () => api.get<WebhookEndpoint>(integrationPaths.webhook(id ?? "")),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}
export function useOutboundWrites(tid: string | undefined, query: Record<string, string>, cursor: string | null) {
  return useQuery({
    queryKey: [...integrationKeys.outboundWrites(tid ?? "", query), cursor ?? ""],
    queryFn: () => page<OutboundWrite>(integrationPaths.outboundWrites(tid ?? ""), query, cursor),
    enabled: Boolean(tid),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
}
export function useOutboundWrite(tid: string | undefined, writeId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.outboundWrite(tid ?? "", writeId ?? ""),
    queryFn: () => api.get<OutboundWriteDetail>(integrationPaths.outboundWrite(tid ?? "", writeId ?? "")),
    enabled: Boolean(tid && writeId),
    retry: shouldRetry,
  });
}
