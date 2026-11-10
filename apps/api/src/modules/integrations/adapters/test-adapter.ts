// The local test adapter (ADR-0055 §3; M0335 "Build working local test adapters and contract tests"; REQ-S17-001,
// REQ-S17-005, REQ-S17-006; p6-work-split §B/A.2; T-DG6-BE-L2).
//
// It implements the adapter port (port.ts) with NO network I/O. Its behaviour comes from the configuration version's
// `adapter_settings`:
//
//   mode      fetch                                               dispatch (outbound)                       outcome(key)
//   healthy   the fixture rows (text only), sourceRowCount = the  {confirmed, TEST-<sha256(key) 12 hex>};    the same answer for a
//             row count, sourceControlTotal = the decimal sum of  with confirm "never": accepted_unconfirmed  dispatched key, else
//             the control column                                   (each key counts ONE effect, ever)          no_response
//   failing   throws connector.source_unavailable                 throws connector.source_unavailable        throws the same
//   stopped   throws connector.stopped                            {no_response}                              {no_response}
//
// The fixture: `adapter_settings.fixture` = { rows: [{column: "text", ...}, ...], controlColumn?: "value" } (every cell
// a string, at most 100 rows), else the A17 default: ten KPI-actual rows for `adapter_settings.kpiId` (default
// "synthetic-kpi"), of which eight are valid, one is invalid (a value that is not a decimal) and one repeats the first
// row's KPI and period (a duplicate in the batch). Every value is SYNTHETIC.
//
// The per-key effect counter is the A13 proof (REQ-S17-006 "replaying an outbound write with the same key produces one
// downstream effect"): `testAdapterEffects(connectorId, key)` is the number of downstream effects the key produced
// (0 or 1). It is process memory, like the downstream system it stands in for; nothing here is "live" or "connected to
// Mobily" (p6-plan R3).
import { createHash } from "node:crypto";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import {
  ConnectorAdapterError,
  type ConnectorAdapter,
  type ConnectorAdapterConfig,
  type ConnectorDispatchOutcome,
  type ConnectorDispatchRequest,
  type ConnectorFetchResult,
} from "./port.ts";

export type TestAdapterMode = "healthy" | "failing" | "stopped";
export type TestAdapterConfirm = "immediate" | "never";

/** A plain decimal string (the contract's Decimal shape; no exponent, no grouping, no locale). */
export const DECIMAL_TEXT = /^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/;
/** The fixture size limit (adapter_settings is at most 4 KiB anyway). */
const MAX_FIXTURE_ROWS = 100;
const DEFAULT_CONTROL_COLUMN = "value";

/** The decimal sum of a column's cells that are plain decimal strings (others contribute nothing); null when none is. */
export function controlTotal(rows: readonly Readonly<Record<string, string | null>>[], column: string): string | null {
  let sum = new D(0);
  let any = false;
  for (const row of rows) {
    let cell: string | null | undefined;
    for (const [k, v] of Object.entries(row)) if (k === column) cell = v;
    if (typeof cell === "string" && DECIMAL_TEXT.test(cell.trim())) {
      sum = sum.plus(new D(cell.trim()));
      any = true;
    }
  }
  return any ? sum.toFixed() : null;
}

/** The A17 default fixture: 10 rows, 8 valid, 1 invalid (value not a decimal), 1 duplicate of row 1 (same KPI, period). */
export function a17Fixture(kpiId: string): Record<string, string>[] {
  const valid = Array.from({ length: 8 }, (_, i) => ({
    source_record_id: `SYN-${String(i + 1).padStart(3, "0")}`,
    kpi_id: kpiId,
    period_label: `2026-${String(i + 1).padStart(2, "0")}`,
    value: `${10 + i}.5`,
  }));
  return [
    ...valid,
    { source_record_id: "SYN-009", kpi_id: kpiId, period_label: "2026-09", value: "not-a-number" },
    { source_record_id: "SYN-010", kpi_id: kpiId, period_label: "2026-01", value: "99" },
  ];
}

function settingString(config: ConnectorAdapterConfig, key: string): string | undefined {
  for (const [k, v] of Object.entries(config.adapterSettings)) if (k === key && typeof v === "string") return v;
  return undefined;
}

function modeOf(config: ConnectorAdapterConfig): TestAdapterMode {
  const mode = settingString(config, "mode");
  // The 0104 trigger and checkConfig guarantee the mode; anything else is a configuration the adapter cannot read.
  if (mode === "healthy" || mode === "failing" || mode === "stopped") return mode;
  throw new ConnectorAdapterError("connector.response_invalid");
}

function confirmOf(config: ConnectorAdapterConfig): TestAdapterConfirm {
  return settingString(config, "confirm") === "never" ? "never" : "immediate";
}

/** The configured fixture (rows of text cells and the control column), or the A17 default. */
function fixtureOf(config: ConnectorAdapterConfig): { rows: Record<string, string>[]; controlColumn: string } {
  let fixture: unknown;
  for (const [k, v] of Object.entries(config.adapterSettings)) if (k === "fixture") fixture = v;
  if (fixture === undefined)
    return {
      rows: a17Fixture(settingString(config, "kpiId") ?? "synthetic-kpi"),
      controlColumn: DEFAULT_CONTROL_COLUMN,
    };
  if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture))
    throw new ConnectorAdapterError("connector.response_invalid");
  const f = new Map(Object.entries(fixture as Record<string, unknown>));
  const rows = f.get("rows");
  const column = f.get("controlColumn") ?? DEFAULT_CONTROL_COLUMN;
  if (!Array.isArray(rows) || rows.length > MAX_FIXTURE_ROWS || typeof column !== "string")
    throw new ConnectorAdapterError("connector.response_invalid");
  const out: Record<string, string>[] = [];
  for (const r of rows as unknown[]) {
    if (r === null || typeof r !== "object" || Array.isArray(r))
      throw new ConnectorAdapterError("connector.response_invalid");
    const cells = Object.entries(r as Record<string, unknown>);
    if (cells.some(([, v]) => typeof v !== "string")) throw new ConnectorAdapterError("connector.response_invalid");
    out.push(Object.fromEntries(cells) as Record<string, string>);
  }
  return { rows: out, controlColumn: column };
}

/**
 * The source rows the test adapter's fixture defines, whatever its mode (T-DG6-BE-X2: the KPIs a failing or stopped run
 * of it feeds, ADR-0053 §2). An unreadable fixture defines none. Reads no network and changes nothing.
 */
export function testAdapterFixtureRows(config: ConnectorAdapterConfig): Record<string, string>[] {
  try {
    return fixtureOf(config).rows;
  } catch {
    return [];
  }
}

/** `TEST-` and the first 12 hex digits of the key's SHA-256: the same key always gives the same reference. */
export function testExternalReference(idempotencyKey: string): string {
  return `TEST-${createHash("sha256").update(idempotencyKey, "utf8").digest("hex").slice(0, 12)}`;
}

/** Downstream effects by `<connectorId>\u0000<key>` (process memory, like the downstream system it stands in for). */
const effects = new Map<string, number>();
const effectKey = (connectorId: string, key: string) => `${connectorId}\u0000${key}`;

/** How many downstream effects the key produced at the test adapter (0 or 1; the A13 proof). */
export function testAdapterEffects(connectorId: string, idempotencyKey: string): number {
  return effects.get(effectKey(connectorId, idempotencyKey)) ?? 0;
}

/** Forgets every recorded effect (tests). */
export function resetTestAdapterEffects(): void {
  effects.clear();
}

function answerFor(config: ConnectorAdapterConfig, idempotencyKey: string): ConnectorDispatchOutcome {
  return confirmOf(config) === "never"
    ? { outcome: "accepted_unconfirmed" }
    : { outcome: "confirmed", externalReference: testExternalReference(idempotencyKey) };
}

/** The local test adapter (kind `test_adapter`). */
export const testAdapter: ConnectorAdapter = Object.freeze({
  kind: "test_adapter" as const,

  async fetch(config: ConnectorAdapterConfig): Promise<ConnectorFetchResult> {
    const mode = modeOf(config);
    if (mode === "failing") throw new ConnectorAdapterError("connector.source_unavailable");
    if (mode === "stopped") throw new ConnectorAdapterError("connector.stopped");
    const { rows, controlColumn } = fixtureOf(config);
    return { rows, sourceRowCount: rows.length, sourceControlTotal: controlTotal(rows, controlColumn) };
  },

  async dispatch(config: ConnectorAdapterConfig, request: ConnectorDispatchRequest): Promise<ConnectorDispatchOutcome> {
    const mode = modeOf(config);
    if (mode === "failing") throw new ConnectorAdapterError("connector.source_unavailable");
    if (mode === "stopped") return { outcome: "no_response" };
    const key = effectKey(config.connectorId, request.idempotencyKey);
    // The downstream deduplicates by key: the first dispatch of a key is its one effect; a replay changes nothing.
    if (!effects.has(key)) effects.set(key, 1);
    return answerFor(config, request.idempotencyKey);
  },

  async outcome(config: ConnectorAdapterConfig, idempotencyKey: string): Promise<ConnectorDispatchOutcome> {
    const mode = modeOf(config);
    if (mode === "failing") throw new ConnectorAdapterError("connector.source_unavailable");
    if (mode === "stopped") return { outcome: "no_response" };
    // Asking for an outcome never creates an effect: a key the downstream never received has no answer.
    if (!effects.has(effectKey(config.connectorId, idempotencyKey))) return { outcome: "no_response" };
    return answerFor(config, idempotencyKey);
  },
});
