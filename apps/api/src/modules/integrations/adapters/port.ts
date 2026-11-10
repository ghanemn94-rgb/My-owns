// The connector adapter port (ADR-0055 §3; REQ-S17-001, REQ-S17-005, REQ-S17-006; T-DG6-BE-L).
//
// An adapter is the only code that talks to a source or a downstream system. It is called OUTSIDE any database
// transaction (p6-work-split §2 rule 4, §B/A.13 item 2): the caller loads the configuration in a short transaction,
// resolves the credential references through the SecretProvider (secret-refs.ts), calls the adapter, and records the
// result in a second short transaction. An adapter never sees a database handle.
//
//   fetch(config, ctx)              rows read from the source, every cell a STRING (never a number: §B/A.13 item 4),
//                                   plus the source's control figures (row count; control total as a decimal string)
//   dispatch(config, request, ctx)  one outbound write with its idempotency key (the downstream deduplicates by key)
//   outcome(config, key, ctx)       the downstream's outcome for a key already dispatched (no new effect)
//
// Failures are ConnectorAdapterError with one of the six error codes of ADR-0055 §4 (each has a "why" and a "what to
// do" text in the problem catalogues). Any other thrown value is treated by the caller as
// `connector.source_unavailable`, and its message is never stored (it could carry a source's response text).
//
// The adapters (the local test adapter and the generic `http_pull` adapter, BE-L2) register in the process registry
// below; `webhook` connectors receive pushed data (ADR-0056 §7) and have no pull adapter. Nothing here is a live
// integration: no corporate source or downstream system is exercised in this release (p6-plan R3, D-195 Q14).
import type { SecretValue } from "../../platform/index.ts";

/** The adapter kinds of `connector.adapter_kind` (0104). */
export const CONNECTOR_ADAPTER_KINDS = ["test_adapter", "webhook", "http_pull"] as const;
export type ConnectorAdapterKind = (typeof CONNECTOR_ADAPTER_KINDS)[number];

/** The connector error codes of ADR-0055 §4 (the contract's ConnectorActionableError.errorCode). */
export const CONNECTOR_ERROR_CODES = [
  "connector.source_unavailable",
  "connector.stopped",
  "connector.credentials_rejected",
  "connector.secret_unresolvable",
  "connector.mapping_mismatch",
  "connector.response_invalid",
] as const;
export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

/** The English "why" text of each error code (ADR-0055 §4, verbatim; `{name}`/`{column}` are message parameters). */
export const CONNECTOR_ERROR_WHY: Readonly<Record<ConnectorErrorCode, string>> = {
  "connector.source_unavailable": "The source system did not respond.",
  "connector.stopped": "The connector's test adapter is stopped.",
  "connector.credentials_rejected": "The source system rejected the connector's credentials.",
  "connector.secret_unresolvable": "The secret reference {name} could not be resolved.",
  "connector.mapping_mismatch": "The source did not provide the mapped column {column}.",
  "connector.response_invalid": "The source returned data the connector cannot read.",
};

/** A failure of an adapter call, with its ADR-0055 §4 code and the message parameters of its texts. */
export class ConnectorAdapterError extends Error {
  readonly code: ConnectorErrorCode;
  readonly params: Readonly<Record<string, string>>;
  constructor(code: ConnectorErrorCode, params: Readonly<Record<string, string>> = {}) {
    super(code);
    this.name = "ConnectorAdapterError";
    this.code = code;
    this.params = params;
  }
}

/** The configuration version an adapter call works with (never a credential value; those come in the context). */
export interface ConnectorAdapterConfig {
  readonly connectorId: string;
  readonly organizationId: string;
  readonly adapterKind: ConnectorAdapterKind;
  readonly configVersionNo: number;
  readonly sourceSystemId: string;
  readonly endpointUrl: string | null;
  readonly fieldMappings: readonly { readonly source: string; readonly target: string }[];
  readonly adapterSettings: Readonly<Record<string, unknown>>;
}

/** What an adapter call receives besides the configuration: the resolved credentials, by their configured name. */
export interface ConnectorAdapterContext {
  /** Resolved just before the call, outside any transaction; printing a SecretValue yields "[secret]". */
  readonly credentials: ReadonlyMap<string, SecretValue>;
  /** The end of the last succeeded run's window (incremental sources), or null. */
  readonly since: Date | null;
}

/** The rows of one fetch: every cell is text (the parser-to-numeric rule, §B/A.13 item 4). */
export interface ConnectorFetchResult {
  readonly rows: readonly Readonly<Record<string, string>>[];
  /** The source's own row count, or null when the source gives none (reconciliation is then not checked). */
  readonly sourceRowCount: number | null;
  /** The source's control total as a decimal string, or null. */
  readonly sourceControlTotal: string | null;
}

export interface ConnectorDispatchRequest {
  readonly action: "deliverable_status_push";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

/** The downstream's answer to a dispatch or an outcome query (ADR-0055 §5 step 4). */
export type ConnectorDispatchOutcome =
  | { readonly outcome: "confirmed"; readonly externalReference: string }
  | { readonly outcome: "accepted_unconfirmed" }
  | { readonly outcome: "rejected"; readonly failureCode: string }
  | { readonly outcome: "no_response" };

/** The adapter port of ADR-0055 §3. */
export interface ConnectorAdapter {
  readonly kind: ConnectorAdapterKind;
  fetch(config: ConnectorAdapterConfig, ctx: ConnectorAdapterContext): Promise<ConnectorFetchResult>;
  dispatch(
    config: ConnectorAdapterConfig,
    request: ConnectorDispatchRequest,
    ctx: ConnectorAdapterContext,
  ): Promise<ConnectorDispatchOutcome>;
  outcome(
    config: ConnectorAdapterConfig,
    idempotencyKey: string,
    ctx: ConnectorAdapterContext,
  ): Promise<ConnectorDispatchOutcome>;
}

export interface ConnectorAdapterRegistry {
  /** Adds an adapter; a second adapter of the same kind is a composition error. */
  register(adapter: ConnectorAdapter): void;
  get(kind: ConnectorAdapterKind): ConnectorAdapter | undefined;
  kinds(): readonly ConnectorAdapterKind[];
}

export function createConnectorAdapterRegistry(adapters: readonly ConnectorAdapter[] = []): ConnectorAdapterRegistry {
  const byKind = new Map<ConnectorAdapterKind, ConnectorAdapter>();
  const registry: ConnectorAdapterRegistry = {
    register(adapter) {
      if (!(CONNECTOR_ADAPTER_KINDS as readonly string[]).includes(adapter.kind))
        throw new Error(`connector adapter kind "${adapter.kind}" is not known`);
      if (byKind.has(adapter.kind)) throw new Error(`connector adapter "${adapter.kind}" is already registered`);
      byKind.set(adapter.kind, adapter);
    },
    get: (kind) => byKind.get(kind),
    kinds: () => [...byKind.keys()],
  };
  for (const adapter of adapters) registry.register(adapter);
  return registry;
}

let processAdapters: ConnectorAdapterRegistry = createConnectorAdapterRegistry();

/** The adapters of this process (BE-L2 registers the test adapter and the http_pull adapter here). */
export function connectorAdapters(): ConnectorAdapterRegistry {
  return processAdapters;
}

/** Replaces the process registry and returns the previous one (composition, and tests that restore it). */
export function setConnectorAdapters(registry: ConnectorAdapterRegistry): ConnectorAdapterRegistry {
  const previous = processAdapters;
  processAdapters = registry;
  return previous;
}
