// The generic `http_pull` adapter (ADR-0055 §1 "the generic adapter slot for a corporate source when access is
// supplied", §3; REQ-S17-001; p6-work-split §B/A.2; T-DG6-BE-L2).
//
// RESIDUAL (p6-plan R3, D-195 Q14, p6-work-split §2 rule 14): no corporate source is exercised in this release. The
// adapter is tested ONLY against the local fake HTTP source (apps/api/test/support/fake-http-source.ts) through the
// shared adapter contract suite (contract.test.ts). It is never "live" or "integrated with Mobily"; a connector using it
// stays "Not verified" until a test run against the endpoint and credential IT supplies succeeds.
//
// Protocol (documented here; the endpoint IT supplies must speak it or be fronted by something that does):
//   GET <endpointUrl>[?since=<ISO-8601>]   Accept: application/json
//   Authorization: Bearer <value>          when the configuration names a credential reference `bearer`
//   200 body: { "rows": [ { "<column>": "<text>", ... }, ... ], "rowCount": <int> | null, "controlTotal": "<decimal>" | null }
// Every cell must be a JSON string (a number is never coerced: §B/A.13 item 4). Classification of failures (ADR-0055 §4):
//   network error, timeout, 5xx, 429                 connector.source_unavailable
//   401, 403                                         connector.credentials_rejected
//   other non-2xx, a body that is not that JSON,     connector.response_invalid
//   a non-string cell, a body over 10 MiB
// The response body is never stored or logged (it could carry a source's text); only the code is recorded.
// Outbound writes are test-adapter only (D-195 Q14; the 0104 trigger refuses outbound actions on other kinds), so
// `dispatch` and `outcome` answer `rejected` without any I/O.
import type { SecretValue } from "../../platform/index.ts";
import {
  ConnectorAdapterError,
  type ConnectorAdapter,
  type ConnectorAdapterConfig,
  type ConnectorAdapterContext,
  type ConnectorDispatchOutcome,
  type ConnectorFetchResult,
} from "./port.ts";
import { DECIMAL_TEXT } from "./test-adapter.ts";

/** The body limit of one pull (the import file limit, ADR-0056 §3). */
export const HTTP_PULL_MAX_BYTES = 10 * 1024 * 1024;
/** One pull waits at most this long (the run's own timeout is longer). */
export const HTTP_PULL_TIMEOUT_MS = 20_000;
/** At most this many rows per pull (the import row limit, ADR-0056 §3). */
const MAX_ROWS = 5_000;

/** The HTTP transport: `fetch` by default; the contract suite routes the configured https URL to the local fake. */
export type HttpPullTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpPullOptions {
  readonly transport?: HttpPullTransport;
  readonly timeoutMs?: number;
}

function credential(ctx: ConnectorAdapterContext, name: string): SecretValue | undefined {
  for (const [k, v] of ctx.credentials) if (k === name) return v;
  return undefined;
}

/** Reads the body up to the limit; over it is connector.response_invalid (the rest is never read). */
async function boundedText(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ConnectorAdapterError("connector.response_invalid");
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ConnectorAdapterError("connector.response_invalid");
  }
}

/** The documented body shape, or connector.response_invalid. */
export function parsePullBody(text: string): ConnectorFetchResult {
  const invalid = () => new ConnectorAdapterError("connector.response_invalid");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw invalid();
  const fields = new Map(Object.entries(body as Record<string, unknown>));
  const rows = fields.get("rows");
  const rowCount = fields.get("rowCount") ?? null;
  const total = fields.get("controlTotal") ?? null;
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw invalid();
  if (rowCount !== null && !(typeof rowCount === "number" && Number.isSafeInteger(rowCount) && rowCount >= 0))
    throw invalid();
  if (total !== null && !(typeof total === "string" && DECIMAL_TEXT.test(total))) throw invalid();
  const out: Record<string, string>[] = [];
  for (const r of rows as unknown[]) {
    if (r === null || typeof r !== "object" || Array.isArray(r)) throw invalid();
    const cells = Object.entries(r as Record<string, unknown>);
    if (cells.some(([, v]) => typeof v !== "string")) throw invalid();
    out.push(Object.fromEntries(cells) as Record<string, string>);
  }
  return { rows: out, sourceRowCount: rowCount as number | null, sourceControlTotal: total as string | null };
}

/** The `http_pull` adapter with an optional transport (tests) and timeout. */
export function createHttpPullAdapter(options: HttpPullOptions = {}): ConnectorAdapter {
  const transport: HttpPullTransport = options.transport ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? HTTP_PULL_TIMEOUT_MS;
  const rejected: ConnectorDispatchOutcome = { outcome: "rejected", failureCode: "outbound_write.action_not_allowed" };
  return Object.freeze({
    kind: "http_pull" as const,

    async fetch(config: ConnectorAdapterConfig, ctx: ConnectorAdapterContext): Promise<ConnectorFetchResult> {
      if (config.endpointUrl === null || !config.endpointUrl.startsWith("https://"))
        throw new ConnectorAdapterError("connector.response_invalid");
      const url = new URL(config.endpointUrl);
      if (ctx.since !== null) url.searchParams.set("since", ctx.since.toISOString());
      const headers: Record<string, string> = { accept: "application/json" };
      const bearer = credential(ctx, "bearer");
      if (bearer !== undefined) headers["authorization"] = `Bearer ${bearer.reveal()}`;
      const signal = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await transport(url.toString(), { method: "GET", headers, redirect: "error", signal });
      } catch {
        throw new ConnectorAdapterError("connector.source_unavailable");
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => undefined);
        throw new ConnectorAdapterError("connector.credentials_rejected");
      }
      if (response.status >= 500 || response.status === 429) {
        await response.body?.cancel().catch(() => undefined);
        throw new ConnectorAdapterError("connector.source_unavailable");
      }
      if (response.status < 200 || response.status > 299) {
        await response.body?.cancel().catch(() => undefined);
        throw new ConnectorAdapterError("connector.response_invalid");
      }
      let text: string;
      try {
        text = await boundedText(response, HTTP_PULL_MAX_BYTES);
      } catch (err) {
        if (err instanceof ConnectorAdapterError) throw err;
        throw new ConnectorAdapterError("connector.source_unavailable");
      }
      return parsePullBody(text);
    },

    async dispatch(): Promise<ConnectorDispatchOutcome> {
      return rejected;
    },

    async outcome(): Promise<ConnectorDispatchOutcome> {
      return rejected;
    },
  });
}
