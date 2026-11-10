// The shared adapter contract suite (ADR-0055 §3 "the same contract suite runs against both adapters"; M0335 "working
// local test adapters and contract tests"; p6-work-split §B/A.2; T-DG6-BE-L2). One set of port obligations, run against
// the local test adapter and against the `http_pull` adapter talking to the local fake HTTP source on loopback (the only
// source exercised: p6-plan R3; no corporate source, nothing "live"):
//   C1 a healthy fetch returns rows whose every cell is TEXT, a row count (integer or null) and a control total (plain
//      decimal string or null);
//   C2 an unavailable source fails with ConnectorAdapterError connector.source_unavailable;
//   C3 every failure is a ConnectorAdapterError with one of the six ADR-0055 §4 codes, never another thrown value;
//   C4 a credential value never appears in what the adapter returns;
//   C5 dispatch and outcome answer one of the four outcomes of the port.
// Then each adapter's own rules (modes and the per-key effect counter; the HTTP status classification and limits).
// It lives in the integration project because it imports the fake source from test/support (a module's own *.test.ts
// may import only modules.ts and architecture.testkit.ts outside src/modules: architecture.testkit.ts). It uses no
// database. Every value is SYNTHETIC.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeHttpSource } from "../../support/fake-http-source.ts";
import { secretValue } from "../../../src/modules/platform/index.ts";
import {
  createHttpPullAdapter,
  HTTP_PULL_MAX_BYTES,
  parsePullBody,
} from "../../../src/modules/integrations/adapters/http-pull.ts";
import {
  CONNECTOR_ERROR_CODES,
  ConnectorAdapterError,
  type ConnectorAdapter,
  type ConnectorAdapterConfig,
  type ConnectorAdapterContext,
} from "../../../src/modules/integrations/adapters/port.ts";
import {
  a17Fixture,
  controlTotal,
  DECIMAL_TEXT,
  resetTestAdapterEffects,
  testAdapter,
  testAdapterEffects,
  testExternalReference,
} from "../../../src/modules/integrations/adapters/test-adapter.ts";

const ENDPOINT = "https://synthetic-source.invalid/kpi-actuals";
const TOKEN = "synthetic-bearer-c0ntract-7d1e";
/** The loopback round trips are a few ms; the hang case waits for the adapter's own short timeout. Budget: 10 s. */
const NET = { timeout: 10_000 };

const config = (over: Partial<ConnectorAdapterConfig> = {}): ConnectorAdapterConfig => ({
  connectorId: "01920006-0000-7000-8000-00000000c0de",
  organizationId: "01920006-0000-7000-8000-0000000000a1",
  adapterKind: "test_adapter",
  configVersionNo: 1,
  sourceSystemId: "synthetic.contract",
  endpointUrl: null,
  fieldMappings: [],
  adapterSettings: { mode: "healthy" },
  ...over,
});

const ctx = (credentials: [string, string][] = []): ConnectorAdapterContext => ({
  credentials: new Map(credentials.map(([k, v]) => [k, secretValue(v)])),
  since: null,
});

async function failure(promise: Promise<unknown>): Promise<ConnectorAdapterError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ConnectorAdapterError);
    expect(CONNECTOR_ERROR_CODES).toContain((err as ConnectorAdapterError).code);
    return err as ConnectorAdapterError;
  }
  throw new Error("expected a ConnectorAdapterError");
}

const source = new FakeHttpSource();
const httpPull = createHttpPullAdapter({
  transport: (url, init) => fetch(url.replace("https://synthetic-source.invalid", source.baseUrl), init),
  timeoutMs: 500,
});

beforeAll(async () => {
  await source.start();
});
afterAll(async () => {
  await source.stop();
});

/** How each adapter is put into a state for the shared obligations. */
interface Subject {
  readonly name: string;
  readonly adapter: ConnectorAdapter;
  healthy(rows: Record<string, string>[]): ConnectorAdapterConfig;
  unavailable(): ConnectorAdapterConfig;
}

const subjects: Subject[] = [
  {
    name: "test_adapter",
    adapter: testAdapter,
    healthy: (rows) => config({ adapterSettings: { mode: "healthy", fixture: { rows } } }),
    unavailable: () => config({ adapterSettings: { mode: "failing" } }),
  },
  {
    name: "http_pull (local fake source)",
    adapter: httpPull,
    healthy: (rows) => {
      source.configure({ kind: "rows", rows, controlTotal: controlTotal(rows, "value") });
      return config({ adapterKind: "http_pull", endpointUrl: ENDPOINT, adapterSettings: {} });
    },
    unavailable: () => {
      source.configure({ kind: "status", status: 503 });
      return config({ adapterKind: "http_pull", endpointUrl: ENDPOINT, adapterSettings: {} });
    },
  },
];

const ROWS = [
  { source_record_id: "SYN-1", kpi_id: "k-1", value: "10.5" },
  { source_record_id: "SYN-2", kpi_id: "k-1", value: "0.25" },
];

describe.each(subjects)("adapter contract: $name", (s) => {
  it("C1: a healthy fetch returns text cells, a row count and a decimal control total", NET, async () => {
    const result = await s.adapter.fetch(s.healthy(ROWS), ctx());
    expect(result.rows).toEqual(ROWS);
    for (const row of result.rows) for (const cell of Object.values(row)) expect(typeof cell).toBe("string");
    expect(result.sourceRowCount === null || Number.isSafeInteger(result.sourceRowCount)).toBe(true);
    expect(result.sourceRowCount).toBe(2);
    expect(result.sourceControlTotal).toBe("10.75");
    expect(DECIMAL_TEXT.test(result.sourceControlTotal!)).toBe(true);
  });

  it("C2/C3: an unavailable source fails with connector.source_unavailable", NET, async () => {
    expect((await failure(s.adapter.fetch(s.unavailable(), ctx()))).code).toBe("connector.source_unavailable");
  });

  it("C4: a credential value never appears in the result", NET, async () => {
    const result = await s.adapter.fetch(s.healthy(ROWS), ctx([["bearer", TOKEN]]));
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("C5: dispatch and outcome answer one of the port's outcomes", NET, async () => {
    const cfg = s.healthy(ROWS);
    const request = {
      action: "deliverable_status_push" as const,
      payload: { status: "done" },
      idempotencyKey: "c5-key-0001",
    };
    const outcomes = ["confirmed", "accepted_unconfirmed", "rejected", "no_response"];
    expect(outcomes).toContain((await s.adapter.dispatch(cfg, request, ctx())).outcome);
    expect(outcomes).toContain((await s.adapter.outcome(cfg, request.idempotencyKey, ctx())).outcome);
  });
});

describe("the local test adapter (ADR-0055 §3)", () => {
  it("healthy without a fixture returns the A17 10-row fixture: 10 rows, a control total, no network", async () => {
    const r = await testAdapter.fetch(config({ adapterSettings: { mode: "healthy", kpiId: "kpi-x" } }), ctx());
    expect(r.rows).toEqual(a17Fixture("kpi-x"));
    expect(r.rows).toHaveLength(10);
    expect(r.sourceRowCount).toBe(10);
    // 10.5 + 11.5 + … + 17.5 (eight valid rows) + 99 (the duplicate); the invalid row's text contributes nothing.
    expect(r.sourceControlTotal).toBe("211");
  });

  it("stopped: fetch fails with connector.stopped; dispatch and outcome answer no_response", async () => {
    const cfg = config({ adapterSettings: { mode: "stopped" } });
    expect((await failure(testAdapter.fetch(cfg, ctx()))).code).toBe("connector.stopped");
    const req = { action: "deliverable_status_push" as const, payload: {}, idempotencyKey: "stopped-key-1" };
    expect(await testAdapter.dispatch(cfg, req, ctx())).toEqual({ outcome: "no_response" });
    expect(await testAdapter.outcome(cfg, req.idempotencyKey, ctx())).toEqual({ outcome: "no_response" });
    expect(testAdapterEffects(cfg.connectorId, req.idempotencyKey)).toBe(0);
  });

  it("failing: fetch, dispatch and outcome fail with connector.source_unavailable", async () => {
    const cfg = config({ adapterSettings: { mode: "failing" } });
    const req = { action: "deliverable_status_push" as const, payload: {}, idempotencyKey: "failing-key-1" };
    expect((await failure(testAdapter.dispatch(cfg, req, ctx()))).code).toBe("connector.source_unavailable");
    expect((await failure(testAdapter.outcome(cfg, req.idempotencyKey, ctx()))).code).toBe(
      "connector.source_unavailable",
    );
  });

  it("a replayed key produces ONE downstream effect and the same reference (A13)", async () => {
    resetTestAdapterEffects();
    const cfg = config();
    const req = { action: "deliverable_status_push" as const, payload: { s: "x" }, idempotencyKey: "replay-key-01" };
    expect(await testAdapter.outcome(cfg, req.idempotencyKey, ctx())).toEqual({ outcome: "no_response" });
    const first = await testAdapter.dispatch(cfg, req, ctx());
    const again = await testAdapter.dispatch(cfg, req, ctx());
    expect(first).toEqual({ outcome: "confirmed", externalReference: testExternalReference(req.idempotencyKey) });
    expect(again).toEqual(first);
    expect(await testAdapter.outcome(cfg, req.idempotencyKey, ctx())).toEqual(first);
    expect(testAdapterEffects(cfg.connectorId, req.idempotencyKey)).toBe(1);
    expect(testExternalReference(req.idempotencyKey)).toMatch(/^TEST-[0-9a-f]{12}$/);
  });

  it("confirm never: the write is accepted but never confirmed (the pending-confirmation path)", async () => {
    const cfg = config({ adapterSettings: { mode: "healthy", confirm: "never" } });
    const req = { action: "deliverable_status_push" as const, payload: {}, idempotencyKey: "never-key-001" };
    expect(await testAdapter.dispatch(cfg, req, ctx())).toEqual({ outcome: "accepted_unconfirmed" });
    expect(await testAdapter.outcome(cfg, req.idempotencyKey, ctx())).toEqual({ outcome: "accepted_unconfirmed" });
    expect(testAdapterEffects(cfg.connectorId, req.idempotencyKey)).toBe(1);
  });

  it("a fixture that is not text rows, or an unknown mode, is connector.response_invalid", async () => {
    for (const settings of [
      { mode: "healthy", fixture: { rows: [{ value: 1 }] } },
      { mode: "healthy", fixture: { rows: "x" } },
      { mode: "healthy", fixture: [] },
      { mode: "paused" },
    ])
      expect((await failure(testAdapter.fetch(config({ adapterSettings: settings }), ctx()))).code).toBe(
        "connector.response_invalid",
      );
  });

  it("controlTotal sums plain decimal cells exactly (no float) and is null when none is a decimal", () => {
    expect(controlTotal([{ value: "0.1" }, { value: "0.2" }], "value")).toBe("0.3");
    expect(controlTotal([{ value: "1e3" }, { value: "x" }], "value")).toBeNull();
    expect(controlTotal([{ value: "-2.5" }, { value: "2.5" }], "value")).toBe("0");
  });
});

describe("the http_pull adapter against the local fake source (residual: no corporate source, p6-plan R3)", () => {
  const cfg = () => config({ adapterKind: "http_pull", endpointUrl: ENDPOINT, adapterSettings: {} });

  it(
    "sends the bearer credential and `since`, and reports 401/403 as connector.credentials_rejected",
    NET,
    async () => {
      source.configure({ kind: "rows", rows: ROWS }, { bearer: TOKEN });
      const since = new Date("2026-10-01T00:00:00.000Z");
      const ok = await httpPull.fetch(cfg(), { ...ctx([["bearer", TOKEN]]), since });
      expect(ok.rows).toHaveLength(2);
      const seen = source.requests.at(-1)!;
      expect(seen.authorization).toBe(`Bearer ${TOKEN}`);
      expect(seen.query["since"]).toBe(since.toISOString());
      expect((await failure(httpPull.fetch(cfg(), ctx([["bearer", "wrong"]])))).code).toBe(
        "connector.credentials_rejected",
      );
      source.configure({ kind: "status", status: 403 });
      expect((await failure(httpPull.fetch(cfg(), ctx()))).code).toBe("connector.credentials_rejected");
    },
  );

  it("5xx, 429 and a hang (timeout) are connector.source_unavailable", NET, async () => {
    for (const status of [500, 502, 429]) {
      source.configure({ kind: "status", status });
      expect((await failure(httpPull.fetch(cfg(), ctx()))).code).toBe("connector.source_unavailable");
    }
    source.configure({ kind: "hang" });
    expect((await failure(httpPull.fetch(cfg(), ctx()))).code).toBe("connector.source_unavailable");
  });

  it(
    "another status, a malformed body, a non-string cell and an oversized body are connector.response_invalid",
    NET,
    async () => {
      source.configure({ kind: "status", status: 404 });
      expect((await failure(httpPull.fetch(cfg(), ctx()))).code).toBe("connector.response_invalid");
      source.configure({ kind: "raw", body: "not json" });
      expect((await failure(httpPull.fetch(cfg(), ctx()))).code).toBe("connector.response_invalid");
      source.configure({ kind: "rows", rows: [{ value: 12.5 }] });
      expect((await failure(httpPull.fetch(cfg(), ctx()))).code).toBe("connector.response_invalid");
      source.configure({ kind: "oversized", bytes: HTTP_PULL_MAX_BYTES + 1 });
      expect((await failure(httpPull.fetch(cfg(), ctx()))).code).toBe("connector.response_invalid");
    },
  );

  it("refuses a non-https endpoint without any request, and never dispatches outbound (test adapter only)", async () => {
    const before = source.requests.length;
    const plain = config({
      adapterKind: "http_pull",
      endpointUrl: "http://synthetic-source.invalid/x",
      adapterSettings: {},
    });
    expect((await failure(httpPull.fetch(plain, ctx()))).code).toBe("connector.response_invalid");
    const req = { action: "deliverable_status_push" as const, payload: {}, idempotencyKey: "pull-key-0001" };
    expect((await httpPull.dispatch(cfg(), req, ctx())).outcome).toBe("rejected");
    expect(source.requests.length).toBe(before);
  });

  it("parsePullBody: row count and control total shapes", () => {
    expect(parsePullBody('{"rows":[],"rowCount":null,"controlTotal":null}')).toEqual({
      rows: [],
      sourceRowCount: null,
      sourceControlTotal: null,
    });
    expect(() => parsePullBody('{"rows":[],"rowCount":-1}')).toThrow(ConnectorAdapterError);
    expect(() => parsePullBody('{"rows":[],"controlTotal":12}')).toThrow(ConnectorAdapterError);
    expect(() => parsePullBody('{"rows":[],"controlTotal":"1e5"}')).toThrow(ConnectorAdapterError);
  });
});
