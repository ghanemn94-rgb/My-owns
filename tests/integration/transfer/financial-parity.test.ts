// T-C17: financial parity of the slice C round trip (ADR-0064; p7-work-split §C.4, §C.6, §C.10; REQ-S19-016 M0364
// "decimal and status integrity across the move"; T-DG7-KBE-A).
//
// Claim under test: benefit totals, allocations, formula versions, KPI calculation runs and Finance validations
// recompute identically after the move (decimal strings exact), and Unknown and Stale stay Unknown and Stale, never 0.
//
// What runs here, and what does not (handback T-DG7-KBE-A §4):
//   - PACKAGE PARITY (runs). The SYNTHETIC demo source is exported with the export's own encoder (BE-D's round-trip
//     fixture). On a SEPARATE, freshly migrated target database, every row of every financial table is decoded from
//     the package by PostgreSQL's own typed decoder (`jsonb_populate_recordset(NULL::<table>, …)`, the decoder ADR-0064
//     §6 names for the load), WITHOUT inserting anything. Each decoded row must equal the source row column for column
//     as text, and the financial recomputation below must give identical results on both sides.
//   - THE LOADED-TARGET HALF (BLOCKED). The import's load (ADR-0064 §6 steps 5-7, 9) is not built: BE-D's open question
//     Q1 (a freshly migrated target already holds migration-written audit_event rows, so step 4 refuses it). That fact is
//     pinned by packages/db/test/integration/transfer-roundtrip.test.ts ("Q1 (BLOCKED …)"). The `it.todo` at the end
//     names the missing check. When the load exists, it is `financialRowsOf(target.db)` compared with
//     `financialRowsOf(source.db)`, through the same `recompute` used here.
//
// Every value is synthetic. Nothing here approves anything: no G1-G6 business approval, no Finance or IT approval. It
// touches no DG0-DG7 record. Arithmetic is decimal throughout (the shared engine's decimal.js; never a binary float).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "../../../packages/db/src/index.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  computeVariance,
  evaluateFormula,
  evaluateRag,
  type FormulaVariable,
  type KpiResult,
  type RagInput,
  type RagThresholdVersion,
} from "../../../packages/shared/src/calc.ts";
import { canonicalDecimal, compareDecimal, sumDecimals } from "../../../packages/shared/src/value.ts";
import type { Db } from "../../../packages/db/src/pool.ts";
import { pinEncoderSettings, type MigrationManifest } from "../../../packages/db/src/transfer/index.ts";
import { testDatabase } from "../../../packages/db/test/helpers.ts";
import {
  RoundtripWorkspace,
  type RoundtripScratch,
} from "../../../packages/db/test/integration/transfer-roundtrip.fixture.ts";

/** The financial tables of T-C17 (benefits, allocations, formulas and their lineage, Finance, KPI runs). */
export const FINANCIAL_TABLES = [
  "benefit",
  "benefit_allocation",
  "benefit_plan_value",
  "benefit_scenario",
  "benefit_scenario_value",
  "benefit_formula",
  "benefit_formula_version",
  "benefit_formula_variable",
  "benefit_calculation",
  "benefit_measurement",
  "benefit_measurement_input",
  "finance_validation",
  "calculation_run",
  "kpi_version",
  "kpi_rag_threshold",
  "kpi_actual_value",
  "kpi_evaluation",
] as const;
export type FinancialTable = (typeof FINANCIAL_TABLES)[number];

/** One row as PostgreSQL's text output of every column (null = SQL NULL). */
export type TextRow = Readonly<Record<string, string | null>>;
export type FinancialRows = Readonly<Record<FinancialTable, readonly TextRow[]>>;

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

async function columnsOf(db: Db, table: string): Promise<string[]> {
  const r = await sql<{ c: string }>`
    SELECT a.attname AS c FROM pg_attribute a
    WHERE a.attrelid = ${table}::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`.execute(db);
  return r.rows.map((x) => x.c);
}

/** `SELECT col::text …` over `from`, ordered by id in byte order (the export's own order for a uuid key). */
function textSelect(columns: readonly string[], from: string): string {
  const list = columns.map((c) => `${ident(c)}::text AS ${ident(c)}`).join(", ");
  return `SELECT ${list} FROM ${from} ORDER BY "id"::text COLLATE "C"`;
}

/** Every financial row of a live database (source today; the loaded target once the import's load exists). */
export async function financialRowsOf(db: Db): Promise<FinancialRows> {
  return db.transaction().execute(async (tx) => {
    await pinEncoderSettings(tx);
    const out: Partial<Record<FinancialTable, TextRow[]>> = {};
    for (const t of FINANCIAL_TABLES) {
      const cols = await columnsOf(db, t);
      out[t] = (await sql<TextRow>`${sql.raw(textSelect(cols, ident(t)))}`.execute(tx)).rows;
    }
    return out as FinancialRows;
  });
}

/**
 * Every financial row of a PACKAGE, decoded on `db` (a separate, freshly migrated target) by PostgreSQL's typed
 * decoder, without inserting anything: numeric, date, timestamptz, boolean and jsonb parse exactly as a load would.
 */
export async function financialRowsOfPackage(db: Db, dir: string): Promise<FinancialRows> {
  return db.transaction().execute(async (tx) => {
    await pinEncoderSettings(tx);
    const out: Partial<Record<FinancialTable, TextRow[]>> = {};
    for (const t of FINANCIAL_TABLES) {
      const lines = readFileSync(join(dir, "tables", `${t}.ndjson`), "utf8")
        .split("\n")
        .filter((l) => l !== "");
      const cols = await columnsOf(db, t);
      // The package's lines travel as ONE bound parameter (a JSON array), never interpolated into the SQL text.
      const [before, after] = textSelect(
        cols,
        `jsonb_populate_recordset(NULL::${ident(t)}, __ROWS__::jsonb) AS r`,
      ).split("__ROWS__") as [string, string];
      out[t] = (await sql<TextRow>`${sql.raw(before)}${`[${lines.join(",")}]`}${sql.raw(after)}`.execute(tx)).rows;
    }
    return out as FinancialRows;
  });
}

// ------------------------------------------------------------------------------------------------ the recomputation

/** A sum that keeps Unknown visible: values with no number are counted, never added as 0. */
export interface UnknownAwareSum {
  readonly sum: string | null;
  readonly known: number;
  readonly unknown: number;
}

export function unknownAwareSum(values: readonly (string | null)[]): UnknownAwareSum {
  const known = values.filter((v): v is string => v !== null);
  return {
    sum: known.length === 0 ? null : sumDecimals(known),
    known: known.length,
    unknown: values.length - known.length,
  };
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list === undefined) m.set(k, [r]);
    else list.push(r);
  }
  return new Map([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const v = (r: TextRow, c: string): string | null => {
  if (!(c in r)) throw new Error(`no column ${c}`);
  return r[c] ?? null;
};
const req = (r: TextRow, c: string): string => {
  const x = v(r, c);
  if (x === null) throw new Error(`column ${c} is NULL`);
  return x;
};
const canon = (x: string | null): string | null => (x === null ? null : canonicalDecimal(x));

/** The financial results recomputed from rows alone (no stored total is trusted). */
export interface FinancialRecomputation {
  /** Planned/forecast totals per benefit and value kind (amount and KPI value kept apart; Unknown counted). */
  readonly planTotals: Record<string, { amount: UnknownAwareSum; kpiValue: UnknownAwareSum }>;
  /** Measured totals per benefit and measurement status; validated value only from status "validated". */
  readonly measurementTotals: Record<string, { amount: UnknownAwareSum; validatedAmount: UnknownAwareSum }>;
  /** Validated realized value per benefit: the sum of validated_amount of validated measurements only. */
  readonly validatedRealized: Record<string, string | null>;
  /** Allocation per benefit and set: allocated share, unallocated share (1 − allocated), and count. */
  readonly allocations: Record<string, { allocated: string; unallocated: string; lines: number }>;
  /** Scenario totals per scenario, kept apart from the actuals above. */
  readonly scenarioTotals: Record<string, UnknownAwareSum>;
  /** Formula versions: the expression's SHA-256 recomputed, and its validation status. */
  readonly formulaVersions: Record<string, { sha256: string; validationStatus: string; expression: string }>;
  /** Each benefit_calculation re-evaluated by the engine from its formula version and its lineage inputs. */
  readonly calculations: Record<string, { result: string | null; errorCode: string | null }>;
  /** Finance validations per status: count and approved-amount sum (Unknown counted). */
  readonly financeTotals: Record<string, { count: number; approved: UnknownAwareSum }>;
  /** KPI calculation runs: per run, the evaluation count and the RAG distribution. */
  readonly kpiRuns: Record<string, { evaluations: number; rag: Record<string, number>; status: string | null }>;
  /** Each KPI evaluation: value status, variance recomputed, RAG recomputed where the engine applies. */
  readonly kpiEvaluations: Record<
    string,
    {
      valueStatus: string;
      value: string | null;
      variance: string | null;
      calculatedRag: string | null;
      deviation: string | null;
      thresholdSource: string | null;
    }
  >;
}

function lineageVariables(inputs: string): FormulaVariable[] {
  const parsed = JSON.parse(inputs) as Record<
    string,
    { name: string; kind: string; unit: string | null; currency: string | null; period: string; value: string | null }
  >;
  return Object.values(parsed).map(
    (x) =>
      ({
        name: x.name,
        kind: x.kind,
        period: x.period,
        unit: x.unit,
        currency: x.currency,
        value: x.value,
      }) as FormulaVariable,
  );
}

function kpiResultOf(status: string, value: string | null, reason: string | null): KpiResult {
  if (value !== null && status === "ok") return { status: "ok", value: canonicalDecimal(value), reason: null };
  if (value !== null && status === "stale")
    return { status: "stale", value: canonicalDecimal(value), reason: "kpi.stale" };
  return { status: "unknown", value: null, reason: (reason ?? "kpi.no_value") as never };
}

export function recompute(rows: FinancialRows): FinancialRecomputation {
  const planTotals: FinancialRecomputation["planTotals"] = {};
  for (const [k, list] of groupBy(rows.benefit_plan_value, (r) => `${req(r, "benefit_id")}|${req(r, "value_kind")}`))
    planTotals[k] = {
      amount: unknownAwareSum(list.map((r) => v(r, "amount"))),
      kpiValue: unknownAwareSum(list.map((r) => v(r, "kpi_value"))),
    };

  const measurementTotals: FinancialRecomputation["measurementTotals"] = {};
  for (const [k, list] of groupBy(rows.benefit_measurement, (r) => `${req(r, "benefit_id")}|${req(r, "status")}`))
    measurementTotals[k] = {
      amount: unknownAwareSum(list.map((r) => v(r, "amount"))),
      validatedAmount: unknownAwareSum(list.map((r) => v(r, "validated_amount"))),
    };

  const validatedRealized: FinancialRecomputation["validatedRealized"] = {};
  for (const [benefitId, list] of groupBy(rows.benefit_measurement, (r) => req(r, "benefit_id"))) {
    const validated = list.filter((r) => v(r, "status") === "validated").map((r) => v(r, "validated_amount"));
    validatedRealized[benefitId] = unknownAwareSum(validated).sum;
  }

  const allocations: FinancialRecomputation["allocations"] = {};
  for (const [k, list] of groupBy(rows.benefit_allocation, (r) => `${req(r, "benefit_id")}|${req(r, "set_no")}`)) {
    const allocated = sumDecimals(list.map((r) => req(r, "share")));
    allocations[k] = { allocated, unallocated: sumDecimals(["1", `-${allocated}`]), lines: list.length };
  }

  const scenarioTotals: FinancialRecomputation["scenarioTotals"] = {};
  const scenarioAmountColumn =
    rows.benefit_scenario_value[0] !== undefined && "amount" in rows.benefit_scenario_value[0];
  for (const [k, list] of groupBy(rows.benefit_scenario_value, (r) => req(r, "scenario_id")))
    scenarioTotals[k] = unknownAwareSum(list.map((r) => (scenarioAmountColumn ? v(r, "amount") : null)));

  const formulaVersions: FinancialRecomputation["formulaVersions"] = {};
  for (const r of rows.benefit_formula_version) {
    const expression = req(r, "expression");
    formulaVersions[req(r, "id")] = {
      sha256: createHash("sha256").update(expression, "utf8").digest("hex"),
      validationStatus: req(r, "validation_status"),
      expression,
    };
  }

  const calculations: FinancialRecomputation["calculations"] = {};
  for (const r of rows.benefit_calculation) {
    const version = formulaVersions[req(r, "formula_version_id")];
    if (version === undefined) throw new Error(`calculation ${req(r, "id")} has no formula version in the rows`);
    const e = evaluateFormula(version.expression, lineageVariables(req(r, "inputs")));
    calculations[req(r, "id")] = { result: e.result, errorCode: e.result === null ? (e.errorCode ?? null) : null };
  }

  const financeTotals: FinancialRecomputation["financeTotals"] = {};
  for (const [status, list] of groupBy(rows.finance_validation, (r) => req(r, "status")))
    financeTotals[status] = { count: list.length, approved: unknownAwareSum(list.map((r) => v(r, "approved_amount"))) };

  const versions = new Map(rows.kpi_version.map((r) => [req(r, "id"), r]));
  const thresholds = new Map(rows.kpi_rag_threshold.map((r) => [req(r, "id"), r]));
  const kpiEvaluations: FinancialRecomputation["kpiEvaluations"] = {};
  for (const r of rows.kpi_evaluation) {
    const version = versions.get(req(r, "kpi_version_id"));
    if (version === undefined) throw new Error(`evaluation ${req(r, "id")} has no KPI version in the rows`);
    const measureType = req(version, "measure_type");
    const valueStatus = req(r, "value_status");
    const value = v(r, "value");
    const expected = v(r, "expected_value");
    const actual = kpiResultOf(valueStatus, value, v(r, "value_reason"));
    const variance =
      actual.value !== null && expected !== null
        ? computeVariance({ actual: actual.value, expected, unitKind: req(version, "unit_kind") as never }).variance
        : null;
    const thresholdId = v(r, "threshold_id");
    const th = thresholdId === null ? undefined : thresholds.get(thresholdId);
    const configured: RagThresholdVersion | null =
      th === undefined
        ? null
        : {
            id: req(th, "id"),
            versionNo: Number(req(th, "version_no")),
            toleranceMode: req(th, "tolerance_mode") as RagThresholdVersion["toleranceMode"],
            amberThreshold: req(th, "amber_threshold"),
            redThreshold: req(th, "red_threshold"),
          };
    let rag: RagInput | null = null;
    if ((measureType === "higher_is_better" || measureType === "lower_is_better") && expected !== null)
      rag = {
        measureType,
        thresholds: configured,
        actual,
        expected: { status: "ok", value: canonicalDecimal(expected), reason: null },
        trajectoryVersion: null,
      };
    else if (
      measureType === "acceptable_band" &&
      v(version, "band_lower") !== null &&
      v(version, "band_upper") !== null
    )
      rag = {
        measureType,
        thresholds: configured,
        actual,
        bandLower: req(version, "band_lower"),
        bandUpper: req(version, "band_upper"),
      };
    const evaluation = rag === null ? null : evaluateRag(rag);
    kpiEvaluations[req(r, "id")] = {
      valueStatus,
      value: canon(value),
      variance,
      calculatedRag: evaluation?.calculatedRag ?? null,
      deviation: evaluation?.deviation ?? null,
      thresholdSource: evaluation?.thresholdSource ?? null,
    };
  }

  const kpiRuns: FinancialRecomputation["kpiRuns"] = {};
  const runs = new Map(rows.calculation_run.map((r) => [req(r, "id"), r]));
  for (const [runId, list] of groupBy(rows.kpi_evaluation, (r) => req(r, "calculation_run_id"))) {
    const rag: Record<string, number> = {};
    for (const e of list) rag[req(e, "calculated_rag")] = (rag[req(e, "calculated_rag")] ?? 0) + 1;
    const run = runs.get(runId);
    kpiRuns[runId] = { evaluations: list.length, rag, status: run === undefined ? null : (v(run, "status") ?? null) };
  }

  return {
    planTotals,
    measurementTotals,
    validatedRealized,
    allocations,
    scenarioTotals,
    formulaVersions,
    calculations,
    financeTotals,
    kpiRuns,
    kpiEvaluations,
  };
}

// ------------------------------------------------------------------------------------------------ the tests

const { adminUrl } = testDatabase();
const ws = new RoundtripWorkspace(adminUrl);
let source: RoundtripScratch;
let target: RoundtripScratch;
let pkg: string;
let manifest: MigrationManifest;
let sourceRows: FinancialRows;
let decodedRows: FinancialRows;

/**
 * One SYNTHETIC Unknown calculation, written as the API's createCalculation writes it (apps/api/src/modules/kpi/
 * calculations.ts): a copy of the first demo calculation whose first input has no value. The engine itself supplies the
 * Unknown result, its error code and its rounding record, so the stored row is exactly what the product would store.
 * benefit_calculation is append-only; this is an INSERT before the export, never an update.
 */
async function addUnknownCalculation(db: Db): Promise<void> {
  const base = await db.selectFrom("benefit_calculation").selectAll().orderBy("id").executeTakeFirstOrThrow();
  const version = await db
    .selectFrom("benefit_formula_version")
    .select("expression")
    .where("id", "=", base.formula_version_id)
    .executeTakeFirstOrThrow();
  const inputs = (typeof base.inputs === "string" ? JSON.parse(base.inputs) : base.inputs) as Record<
    string,
    { value: string | null }
  >;
  const first = Object.keys(inputs)[0]!;
  const lineage = { ...inputs, [first]: { ...inputs[first]!, value: null } };
  const e = evaluateFormula(version.expression, lineageVariables(JSON.stringify(lineage)));
  expect(e.result, "the engine gives Unknown for a missing input").toBeNull();
  await db
    .insertInto("benefit_calculation")
    .values({
      id: sql<string>`mth_uuid_v7()`,
      organization_id: base.organization_id,
      transformation_id: base.transformation_id,
      formula_version_id: base.formula_version_id,
      inputs: JSON.stringify(lineage),
      assumptions: "SYNTHETIC: one input withheld to prove Unknown survives the move (T-C17)",
      period_start: base.period_start,
      period_end: base.period_end,
      outcome: "error",
      result: null,
      result_kind: base.result_kind,
      result_unit: base.result_unit,
      result_currency: base.result_currency,
      result_period: base.result_period,
      error_code: e.errorCode ?? "formula.missing_input",
      engine_version: e.engineVersion,
      computed_by: base.computed_by,
      rounding: JSON.stringify(e.rounding),
    })
    .execute();
}

beforeAll(async () => {
  source = await ws.demoSource("mth_fp_source");
  await addUnknownCalculation(source.db);
  const exported = await ws.exportPackage(source.db);
  pkg = exported.dir;
  manifest = exported.result.manifest;
  // A separate installation's database: the package is decoded there, by its own types, never by the source's.
  target = await ws.migrated("mth_fp_target");
  sourceRows = await financialRowsOf(source.db);
  decodedRows = await financialRowsOfPackage(target.db, pkg);
}, 600_000);

afterAll(async () => {
  await ws.close();
}, 120_000);

describe("T-C17 (package parity): every financial row survives the package exactly", () => {
  it("every financial table travels in the package (none excluded) and the demo exercises each case", () => {
    const exported = new Set(manifest.tables.map((t) => t.name));
    const excluded = new Set(manifest.excludedTables.map((t) => t.name));
    for (const t of FINANCIAL_TABLES) {
      expect(exported.has(t), `${t} is exported`).toBe(true);
      expect(excluded.has(t), `${t} is not excluded`).toBe(false);
    }
    // The SYNTHETIC demo must actually hold the cases this test claims to cover (a vacuous parity proves nothing).
    for (const t of [
      "benefit",
      "benefit_allocation",
      "benefit_plan_value",
      "benefit_formula_version",
      "benefit_calculation",
      "benefit_measurement",
      "finance_validation",
      "calculation_run",
      "kpi_evaluation",
    ] as const)
      expect(sourceRows[t].length, `${t} has demo rows`).toBeGreaterThan(0);
    const statuses = new Set(sourceRows.kpi_evaluation.map((r) => v(r, "value_status")));
    expect(statuses.has("stale"), "a Stale KPI value exists").toBe(true);
    const rags = new Set(sourceRows.kpi_evaluation.map((r) => v(r, "calculated_rag")));
    expect(rags.has("unknown"), "an Unknown RAG exists").toBe(true);
    expect(rags.has("stale"), "a Stale RAG exists").toBe(true);
    const fv = new Set(sourceRows.finance_validation.map((r) => v(r, "status")));
    expect(fv.size, "more than one Finance validation status (approved and pending)").toBeGreaterThan(1);
  });

  it("no numeric value is a JSON number in any financial table file (decimal strings only)", () => {
    for (const t of FINANCIAL_TABLES) {
      const lines = readFileSync(join(pkg, "tables", `${t}.ndjson`), "utf8")
        .split("\n")
        .filter((l) => l !== "");
      expect(lines.length, `${t} line count = manifest rowCount`).toBe(
        Number(manifest.tables.find((x) => x.name === t)!.rowCount),
      );
      for (const line of lines) {
        const obj = JSON.parse(line) as Record<string, unknown>;
        for (const [col, value] of Object.entries(obj))
          expect(typeof value === "number", `${t}.${col} is a JSON number`).toBe(false);
      }
    }
  });

  it("each row decoded on the target equals its source row, column for column as text", () => {
    for (const t of FINANCIAL_TABLES) {
      expect(decodedRows[t].length, `${t} row count`).toBe(sourceRows[t].length);
      expect(decodedRows[t], `${t} rows`).toEqual(sourceRows[t]);
    }
  });
});

describe("T-C17 (recomputation): the financial results recompute identically from the decoded rows", () => {
  let fromSource: FinancialRecomputation;
  let fromPackage: FinancialRecomputation;
  beforeAll(() => {
    fromSource = recompute(sourceRows);
    fromPackage = recompute(decodedRows);
  });

  it("benefit totals: plan, measured and validated realized value are equal as exact decimal strings", () => {
    expect(fromPackage.planTotals).toEqual(fromSource.planTotals);
    expect(fromPackage.measurementTotals).toEqual(fromSource.measurementTotals);
    expect(fromPackage.validatedRealized).toEqual(fromSource.validatedRealized);
    expect(fromPackage.scenarioTotals).toEqual(fromSource.scenarioTotals);
    expect(Object.keys(fromSource.planTotals).length).toBeGreaterThan(0);
    // Submitted (unvalidated) value never counts as validated realized value.
    for (const r of decodedRows.benefit_measurement)
      if (v(r, "status") !== "validated") expect(v(r, "validated_amount"), `measurement ${req(r, "id")}`).toBeNull();
  });

  it("allocations: each set's allocated share is equal, at most 100%, with the unallocated share shown", () => {
    expect(fromPackage.allocations).toEqual(fromSource.allocations);
    expect(Object.keys(fromSource.allocations).length).toBeGreaterThan(0);
    for (const [k, a] of Object.entries(fromPackage.allocations)) {
      expect(compareDecimal(a.allocated, "1"), `${k} allocated ≤ 1`).toBeLessThanOrEqual(0);
      expect(compareDecimal(a.unallocated, "0"), `${k} unallocated ≥ 0`).toBeGreaterThanOrEqual(0);
    }
  });

  it("formula versions: expression hashes match the stored hash and every calculation re-evaluates to its stored result", () => {
    expect(fromPackage.formulaVersions).toEqual(fromSource.formulaVersions);
    for (const r of decodedRows.benefit_formula_version)
      expect(fromPackage.formulaVersions[req(r, "id")]!.sha256, `version ${req(r, "id")}`).toBe(
        req(r, "expression_sha256"),
      );
    expect(fromPackage.calculations).toEqual(fromSource.calculations);
    for (const r of decodedRows.benefit_calculation) {
      const again = fromPackage.calculations[req(r, "id")]!;
      // The engine's result is canonical; the stored result is numeric(24,6). Unknown stays NULL, never "0".
      expect(again.result === null ? null : canonicalDecimal(again.result), `calculation ${req(r, "id")}`).toBe(
        canon(v(r, "result")),
      );
      expect(again.errorCode, `calculation ${req(r, "id")} error code`).toBe(v(r, "error_code"));
    }
  });

  it("Finance validations: statuses, counts and approved amounts are equal; approvals equal the validated amount", () => {
    expect(fromPackage.financeTotals).toEqual(fromSource.financeTotals);
    const measurements = new Map(decodedRows.benefit_measurement.map((m) => [req(m, "id"), m]));
    for (const f of decodedRows.finance_validation) {
      const m = measurements.get(req(f, "benefit_measurement_id"))!;
      if (v(f, "approved_amount") !== null && v(m, "status") === "validated")
        expect(
          compareDecimal(req(f, "approved_amount"), req(m, "validated_amount")),
          `validation ${req(f, "id")}`,
        ).toBe(0);
      if (v(f, "decided_at") === null)
        expect(v(f, "approved_amount"), `undecided validation ${req(f, "id")} has no amount`).toBeNull();
    }
  });

  it("KPI calculation runs: evaluations, variances and recomputed RAG are equal and match the stored ones", () => {
    expect(fromPackage.kpiRuns).toEqual(fromSource.kpiRuns);
    expect(fromPackage.kpiEvaluations).toEqual(fromSource.kpiEvaluations);
    let recomputedRag = 0;
    for (const r of decodedRows.kpi_evaluation) {
      const again = fromPackage.kpiEvaluations[req(r, "id")]!;
      if (again.variance !== null && v(r, "variance") !== null)
        expect(compareDecimal(again.variance, req(r, "variance")), `evaluation ${req(r, "id")} variance`).toBe(0);
      if (again.calculatedRag !== null && v(r, "value_status") !== "stale") {
        recomputedRag += 1;
        expect(again.calculatedRag, `evaluation ${req(r, "id")} RAG`).toBe(v(r, "calculated_rag"));
        expect(again.deviation, `evaluation ${req(r, "id")} deviation`).toBe(v(r, "deviation"));
      }
    }
    expect(recomputedRag, "at least one RAG recomputed by the engine").toBeGreaterThan(0);
  });

  it("Unknown and Stale stay Unknown and Stale after the move, never 0 and never green", () => {
    const src = new Map(sourceRows.kpi_evaluation.map((r) => [req(r, "id"), r]));
    let unknown = 0;
    let stale = 0;
    for (const r of decodedRows.kpi_evaluation) {
      const s = src.get(req(r, "id"))!;
      expect(v(r, "value_status")).toBe(v(s, "value_status"));
      expect(v(r, "calculated_rag")).toBe(v(s, "calculated_rag"));
      if (v(s, "value") === null) {
        unknown += 1;
        expect(v(r, "value"), `evaluation ${req(r, "id")}: Unknown is not 0`).toBeNull();
        expect(["green", "amber", "red"]).not.toContain(v(r, "calculated_rag"));
      }
      if (v(s, "value_status") === "stale") {
        stale += 1;
        expect(v(r, "value"), "a Stale value keeps its number").toBe(v(s, "value"));
        expect(v(r, "calculated_rag"), "a Stale value is never green").not.toBe("green");
      }
    }
    // The demo's Unknown KPI results are Unknown RAGs (no expected value to compare with), with the value kept.
    for (const r of decodedRows.kpi_evaluation)
      if (v(r, "calculated_rag") === "unknown") {
        unknown += 1;
        expect(v(r, "deviation"), `evaluation ${req(r, "id")}: an Unknown RAG has an unknown deviation`).toBe(
          "unknown",
        );
      }
    expect(unknown, "Unknown KPI results").toBeGreaterThan(0);
    expect(stale, "Stale KPI values").toBeGreaterThan(0);
    // An Unknown calculation result stays NULL (never "0") and re-evaluates to Unknown with the same error code.
    const unknownCalcs = decodedRows.benefit_calculation.filter((r) => v(r, "result") === null);
    expect(unknownCalcs.length, "Unknown calculation results").toBeGreaterThan(0);
    for (const r of unknownCalcs) {
      expect(v(r, "outcome")).toBe("error");
      const again = recompute(decodedRows).calculations[req(r, "id")]!;
      expect(again.result, `calculation ${req(r, "id")} stays Unknown`).toBeNull();
      expect(again.errorCode).toBe(v(r, "error_code"));
    }
    // Unknown money and calculation results stay NULL (never 0) in every financial table.
    const nulls = (t: FinancialTable, c: string) => [
      sourceRows[t].filter((r) => v(r, c) === null).length,
      decodedRows[t].filter((r) => v(r, c) === null).length,
    ];
    for (const [t, c] of [
      ["benefit_plan_value", "amount"],
      ["benefit_measurement", "amount"],
      ["benefit_measurement", "validated_amount"],
      ["benefit_calculation", "result"],
      ["finance_validation", "approved_amount"],
      ["kpi_evaluation", "value"],
      ["kpi_evaluation", "variance"],
    ] as const) {
      const [a, b] = nulls(t, c);
      expect(b, `${t}.${c} NULL count`).toBe(a);
    }
  });
});

describe("T-C17 (negative control): the parity is not vacuous", () => {
  it("one plan amount changed by 0.0001 in a package copy is caught by the rows and by the recomputed totals", async () => {
    const copy = ws.copyPackage(pkg);
    const file = join(copy, "tables", "benefit_plan_value.ndjson");
    const lines = readFileSync(file, "utf8").split("\n");
    const i = lines.findIndex((l) => /"amount":"-?[0-9]/.test(l));
    expect(i, "a plan value with an amount").toBeGreaterThanOrEqual(0);
    const row = JSON.parse(lines[i]!) as Record<string, string | null>;
    row["amount"] = sumDecimals([row["amount"]!, "0.0001"]);
    lines[i] = JSON.stringify(row);
    writeFileSync(file, lines.join("\n"));
    const tampered = await financialRowsOfPackage(target.db, copy);
    expect(tampered.benefit_plan_value).not.toEqual(sourceRows.benefit_plan_value);
    expect(recompute(tampered).planTotals).not.toEqual(recompute(sourceRows).planTotals);
    // Everything else is untouched.
    expect(tampered.benefit_measurement).toEqual(sourceRows.benefit_measurement);
  }, 120_000);
});

describe("T-C17 (loaded target): BLOCKED until the import's load exists (BE-D Q1)", () => {
  it.todo(
    "after import-migration exits 0: recompute(financialRowsOf(target.db)) equals recompute(financialRowsOf(source.db)), " +
      "and the target's benefit_counting and benefit_value_line views equal the source's (blocked: ADR-0064 §6 steps " +
      "5-7 and 9 not built; T-DG7-BE-D handback Q1)",
  );
});
