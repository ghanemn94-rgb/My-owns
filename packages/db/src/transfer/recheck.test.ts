// Unit parts of T-R7 and T-R15 (ADR-0064 A1.9, A2.6; p7-work-split §C.13; T-DG7-BE-R2), and of T-R21 and T-R22
// (Amendment 3 §A3.3, §A3.4; §C.14; T-DG7-BE-R3): the constants' disjointness and coverage, the counter prefix map
// pinned to the 0055 CHECK and the schema, the counter step rule, and the structural allowance refusals (no database);
// and the unit parts of T-R27 (Amendment 4 §A4.2, §A4.5; §C.15; T-DG7-BE-R4): `/4` with `lineage`, its refusals and the
// lineage constants. Nothing here approves anything (no G1-G6, Finance or IT approval) or touches DG0-DG7.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEMA_COLUMNS } from "../schema.ts";
import {
  ALLOWANCE_SCHEMA_VERSION,
  AllowanceRefused,
  childrenOrder,
  counterLine,
  counterStepExplained,
  explainCounters,
  isNeverOperational,
  parseAllowance,
  RECHECK_COUNTER_TABLES,
  RECHECK_FINANCIAL_TABLES,
  RECHECK_NEVER_OPERATIONAL,
  RECHECK_CHAIN_MAX_DEPTH,
  RECHECK_LINEAGE_COLUMNS,
  RECHECK_LINEAGE_LINKS,
  RECHECK_LINEAGE_OUTBOX,
  RECHECK_LINEAGE_TABLES,
  RECHECK_OPERATIONAL_TABLES,
} from "./recheck.ts";
import type { TransferPlan, TransferPlanTable } from "./plan.ts";
import type { EncodedRow } from "./table-digest.ts";

const bytes = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));
const base = (over: Record<string, unknown> = {}) => ({
  schemaVersion: ALLOWANCE_SCHEMA_VERSION,
  actors: [],
  tables: [],
  audited: [],
  children: [],
  counters: [],
  lineage: [],
  operational: [],
  ...over,
});
const ACTOR = "01930000-0000-7000-8000-000000000001";
const refusal = (v: unknown): string => {
  try {
    parseAllowance(bytes(v));
  } catch (err) {
    if (err instanceof AllowanceRefused)
      return err.message.replace(/^reconcile-migration: refused: invalid allowance file: /, "");
    throw err;
  }
  return "accepted";
};

describe("the recheck constants (A1.9 rule 6)", () => {
  it("RECHECK_OPERATIONAL_TABLES and RECHECK_NEVER_OPERATIONAL are disjoint", () => {
    for (const t of RECHECK_OPERATIONAL_TABLES) expect(isNeverOperational(t), t).toBe(false);
  });

  it("RECHECK_NEVER_OPERATIONAL names every A1.9 rule 6 table, with the 17 financial tables read from T-C17's list", () => {
    const text = readFileSync(
      new URL("../../../../tests/integration/transfer/financial-parity.test.ts", import.meta.url),
      "utf8",
    );
    const list = /export const FINANCIAL_TABLES = \[([^\]]*)\]/.exec(text)![1]!;
    const financial = [...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
    expect(financial).toHaveLength(17);
    expect([...RECHECK_FINANCIAL_TABLES]).toEqual(financial);
    for (const t of [
      "audit_event",
      "app_user",
      "user_identity",
      "scoped_assignment",
      "delegation",
      "gate_decision",
      "approval",
      "approval_decision",
      ...financial,
    ])
      expect(RECHECK_NEVER_OPERATIONAL, t).toContain(t);
    expect(isNeverOperational("decision_option")).toBe(true);
  });
});

describe("parseAllowance (mth-recheck-allowance/4; T-R21 and T-R27 unit)", () => {
  it("accepts a well-formed file", () => {
    const a = parseAllowance(
      bytes(
        base({
          actors: [ACTOR],
          tables: [{ name: "transformation", added: [["a"]], changed: [] }],
          audited: [{ name: "gate_instance", mustInclude: { added: [], changed: [["b"]] } }],
          children: [{ name: "gate_instance_note", parent: "gate_instance", fkey: "gate_instance_note_fkey" }],
          counters: ["record_code_counter"],
          operational: ["job_run"],
        }),
      ),
    );
    expect(ALLOWANCE_SCHEMA_VERSION).toBe("mth-recheck-allowance/4");
    expect(a.lineage).toEqual([]);
    expect(a.counters).toEqual(["record_code_counter"]);
    expect(a.tables[0]!.added).toEqual([["a"]]);
    expect(childrenOrder(a).map((c) => c.name)).toEqual(["gate_instance_note"]);
  });

  it("refuses each structural fault with its reason", () => {
    for (const v of ["mth-recheck-allowance/1", "mth-recheck-allowance/2", "mth-recheck-allowance/3"])
      expect(refusal({ ...base(), schemaVersion: v })).toBe(`unsupported schema version '${v}'`);
    // A /2 file as the drill wrote it before A3.4 (no counters) is refused for its version, not its keys.
    const v2: Record<string, unknown> = { ...base(), schemaVersion: "mth-recheck-allowance/2" };
    delete v2["counters"];
    expect(refusal(v2)).toBe("unsupported schema version 'mth-recheck-allowance/2'");
    expect(refusal(base({ counters: ["record_code_counters"] }))).toBe(
      "counter table record_code_counters is not in RECHECK_COUNTER_TABLES",
    );
    expect(refusal(base({ counters: ["benefit"] }))).toBe("counter table benefit is not in RECHECK_COUNTER_TABLES");
    expect(
      refusal(
        base({
          counters: ["record_code_counter"],
          children: [{ name: "record_code_counter", parent: "transformation", fkey: "record_code_counter_fkey" }],
        }),
      ),
    ).toBe("record_code_counter is listed more than once");
    expect(refusal(base({ counters: ["record_code_counter", "record_code_counter"] }))).toBe(
      "record_code_counter is listed more than once",
    );
    for (const k of ["actors", "tables", "audited", "children", "counters", "lineage", "operational"]) {
      const v: Record<string, unknown> = base();
      delete v[k];
      expect(refusal(v)).toBe(`missing key '${k}'`);
    }
    expect(refusal("{not json")).toBe("not strict UTF-8 JSON");
    expect(refusal(base({ audited: [{ name: "benefit", mustInclude: { added: [], changed: [] } }] }))).toBe(
      "actors is empty but audited is not",
    );
    expect(
      refusal(
        base({
          tables: [{ name: "benefit", added: [], changed: [] }],
          operational: ["benefit"],
        }),
      ),
    ).toBe("benefit is listed both in tables and in operational");
    expect(refusal(base({ operational: ["benefit"] }))).toBe("benefit is not an operational table");
    expect(
      refusal(
        base({
          tables: [
            { name: "benefit", added: [], changed: [] },
            { name: "benefit", added: [], changed: [] },
          ],
        }),
      ),
    ).toBe("benefit is listed more than once");
    expect(refusal(base({ tables: [{ name: "benefit", added: [[1]], changed: [] }] }))).toBe(
      "malformed key tuple in benefit",
    );
    expect(refusal(base({ tables: [{ name: "audit_event", added: [], changed: [] }] }))).toBe(
      "audit_event may not be listed (A1.9 rule 1)",
    );
    expect(refusal(base({ actors: ["not-a-uuid"] }))).toBe("actors must be an array of app_user ids");
  });

  it("refuses a children cycle", () => {
    const a = parseAllowance(
      bytes(
        base({
          children: [
            { name: "a_child", parent: "b_child", fkey: "a_fkey" },
            { name: "b_child", parent: "a_child", fkey: "b_fkey" },
          ],
        }),
      ),
    );
    expect(() => childrenOrder(a)).toThrow("children form a cycle at a_child");
  });
});

describe("T-R22: RECHECK_COUNTER_TABLES pinned to the 0055 CHECK and to the schema (A3.3 item 1)", () => {
  const c = RECHECK_COUNTER_TABLES["record_code_counter"]!;

  it("prefixes and unmapped together are exactly the 24 prefixes of the 0055 CHECK, and disjoint", () => {
    const text = readFileSync(
      new URL("../../migrations/0055_p4_traceability_modular_structure.sql", import.meta.url),
      "utf8",
    );
    const check = /record_code_counter_prefix_check\s+CHECK \(prefix IN \(([^)]*)\)\)/.exec(text)![1]!;
    const fromCheck = [...check.matchAll(/'([A-Z]+)'/g)].map((m) => m[1]!).sort();
    expect(fromCheck).toHaveLength(24);
    const mapped = Object.keys(c.prefixes);
    for (const p of c.unmapped) expect(mapped, p).not.toContain(p);
    expect([...mapped, ...c.unmapped].sort()).toEqual(fromCheck);
  });

  it("the counter and each mapped table have the scope column and the code column (SCHEMA_COLUMNS)", () => {
    const cols = SCHEMA_COLUMNS as unknown as Record<string, readonly string[]>;
    expect(cols[c.name]).toEqual(expect.arrayContaining([c.scope, c.prefixColumn, c.valueColumn]));
    for (const [p, t] of Object.entries(c.prefixes)) {
      expect(cols[t.table], `${p} -> ${t.table}`).toBeDefined();
      expect(cols[t.table], `${p} -> ${t.table}`).toEqual(expect.arrayContaining([c.scope, t.code]));
    }
  });
});

describe("the counter step rule (A3.3 item 4)", () => {
  it("explains exactly {old+1 .. new}, each number once", () => {
    expect(counterStepExplained(0, 1, [1])).toBe(true);
    expect(counterStepExplained(4, 6, [6, 5])).toBe(true);
    expect(counterStepExplained(0, 2, [1])).toBe(false);
    expect(counterStepExplained(0, 2, [1, 1])).toBe(false);
    expect(counterStepExplained(0, 1, [1, 2])).toBe(false);
    expect(counterStepExplained(3, 3, [])).toBe(false);
    expect(counterStepExplained(3, 3, [4])).toBe(false);
    expect(counterStepExplained(0, 1, [])).toBe(false);
    expect(counterStepExplained(0, 1, [2])).toBe(false);
  });

  it("prints the C.14 line", () => {
    expect(counterLine({ key: '["t","I"]', old: 0, new: 2, codes: [1], explained: false })).toBe(
      '    counter ["t","I"]: moved 0 -> 2, 1 new coded rows (1)',
    );
    expect(counterLine({ key: '["t","R"]', old: 1, new: 2, codes: [], explained: false })).toBe(
      '    counter ["t","R"]: moved 1 -> 2, 0 new coded rows (none)',
    );
  });
});

describe("T-R20 unit: explainCounters keeps D-, DEC- and DEP- apart in one transformation (A3.3 item 4)", () => {
  const c = RECHECK_COUNTER_TABLES["record_code_counter"]!;
  const table = (name: string, cols: string[], pk: string[]) =>
    ({ name, columns: cols.map((n) => ({ name: n, type: "text" })), primaryKey: pk }) as unknown as TransferPlanTable;
  const counter = table(
    "record_code_counter",
    ["transformation_id", "prefix", "last_value"],
    ["transformation_id", "prefix"],
  );
  const decision = table("decision", ["id", "transformation_id", "code"], ["id"]);
  const dependency = table("dependency", ["id", "transformation_id", "code"], ["id"]);
  const plan = { tables: [counter, decision, dependency] } as unknown as TransferPlan;
  const row = (values: string[]): EncodedRow => ({
    key: JSON.stringify(values.slice(0, 1)),
    values,
    line: JSON.stringify(values),
  });
  const cRow = (p: string, v: number): EncodedRow => ({
    key: JSON.stringify(["t1", p]),
    values: ["t1", p, String(v)],
    line: "",
  });
  const pkgLine = (p: string, v: number) =>
    [JSON.stringify(["t1", p]), JSON.stringify({ transformation_id: "t1", prefix: p, last_value: v })] as const;

  it("each counter counts only its own prefix's codes", () => {
    const pkg = new Map([pkgLine("D", 3), pkgLine("DEC", 1), pkgLine("DEP", 7)]);
    const cmp = { added: [], changed: [cRow("D", 4), cRow("DEC", 2), cRow("DEP", 8)], missing: [], unchanged: 0 };
    const explained = new Map([
      ["decision", [row(["d1", "t1", "D-04"]), row(["d2", "t1", "DEC-02"])]],
      ["dependency", [row(["p1", "t1", "DEP-08"])]],
    ]);
    const r = explainCounters(c, counter, pkg, cmp, explained, plan);
    expect(r.explained).toBe(true);
    expect(r.verdicts.map((v) => [v.key, v.old, v.new, v.codes])).toEqual([
      [JSON.stringify(["t1", "D"]), 3, 4, [4]],
      [JSON.stringify(["t1", "DEC"]), 1, 2, [2]],
      [JSON.stringify(["t1", "DEP"]), 7, 8, [8]],
    ]);
  });

  it("a DEC- code never counts for D (and the reverse), and a missing counter row is unexplained", () => {
    const pkg = new Map([pkgLine("D", 3), pkgLine("DEC", 1)]);
    const cmp = { added: [], changed: [cRow("D", 4)], missing: [JSON.stringify(["t1", "DEC"])], unchanged: 0 };
    const explained = new Map([["decision", [row(["d2", "t1", "DEC-04"])]]]);
    const r = explainCounters(c, counter, pkg, cmp, explained, plan);
    expect(r.explained).toBe(false);
    const d = r.verdicts.find((v) => v.key === JSON.stringify(["t1", "D"]))!;
    expect(d).toMatchObject({ old: 3, new: 4, codes: [], explained: false });
    // The DEC row with no counter step is reported (item 5), and the missing row is returned (item 6).
    expect(r.verdicts.find((v) => v.key === JSON.stringify(["t1", "DEC"]))).toMatchObject({
      old: 1,
      new: 1,
      codes: [4],
      explained: false,
    });
    expect(r.missing).toEqual([JSON.stringify(["t1", "DEC"])]);
  });
});

describe("T-R27: allowance /4 and the lineage constants (ADR-0064 A4.2, A4.5)", () => {
  const lineageAllowance = (lineage: unknown[], audited: unknown[] = []) =>
    base({ actors: audited.length > 0 ? [ACTOR] : [], audited, lineage });
  const CASE = { name: "corrective_case", mustInclude: { added: [], changed: [] } };
  const all4 = [
    { name: "calculation_run", mustInclude: { added: [] } },
    { name: "kpi_evaluation", mustInclude: { added: [["k1"]] } },
    { name: "data_quality_finding", mustInclude: { added: [] } },
    { name: "corrective_signal", mustInclude: { added: [] } },
  ];

  it("accepts /4 with its eight keys and the four lineage tables", () => {
    const v = lineageAllowance(all4, [CASE]);
    expect(Object.keys(v)).toHaveLength(8);
    const a = parseAllowance(bytes(v));
    expect(a.lineage.map((l) => l.name)).toEqual([
      "calculation_run",
      "kpi_evaluation",
      "data_quality_finding",
      "corrective_signal",
    ]);
    expect(a.lineage[1]!.mustInclude.added).toEqual([["k1"]]);
  });

  it("refuses /1-/3, a missing lineage key and an unknown key", () => {
    for (const v of ["mth-recheck-allowance/1", "mth-recheck-allowance/2", "mth-recheck-allowance/3"]) {
      const x: Record<string, unknown> = { ...base(), schemaVersion: v };
      delete x["lineage"];
      expect(refusal(x)).toBe(`unsupported schema version '${v}'`);
    }
    const noLineage: Record<string, unknown> = base();
    delete noLineage["lineage"];
    expect(refusal(noLineage)).toBe("missing key 'lineage'");
    expect(refusal({ ...base(), extra: [] })).toBe("unknown key 'extra'");
  });

  it("refuses each A4.5 lineage fault with its A4.7 reason", () => {
    expect(refusal(lineageAllowance([{ name: "benefit_calculation", mustInclude: { added: [] } }]))).toBe(
      "lineage table benefit_calculation is not in RECHECK_LINEAGE_TABLES",
    );
    expect(
      refusal(
        lineageAllowance([
          { name: "calculation_run", mustInclude: { added: [] } },
          { name: "calculation_run", mustInclude: { added: [] } },
        ]),
      ),
    ).toBe("calculation_run is listed more than once");
    expect(
      refusal(
        base({
          tables: [{ name: "kpi_evaluation", added: [], changed: [] }],
          lineage: [
            { name: "calculation_run", mustInclude: { added: [] } },
            { name: "kpi_evaluation", mustInclude: { added: [] } },
          ],
        }),
      ),
    ).toBe("kpi_evaluation is listed more than once");
    for (const t of ["kpi_evaluation", "data_quality_finding"])
      expect(refusal(lineageAllowance([{ name: t, mustInclude: { added: [] } }]))).toBe(
        `lineage table ${t} needs calculation_run in lineage`,
      );
    expect(refusal(lineageAllowance([{ name: "corrective_signal", mustInclude: { added: [] } }]))).toBe(
      "lineage table corrective_signal needs corrective_case in audited",
    );
    expect(refusal(lineageAllowance([{ name: "calculation_run" }]))).toBe("lineage[0] is not an object");
    expect(refusal(lineageAllowance([{ name: "calculation_run", mustInclude: { added: [[2]] } }]))).toBe(
      "malformed key tuple in calculation_run",
    );
  });

  it("RECHECK_LINEAGE_TABLES names exactly the four tables, none of them operational; the depth is 5", () => {
    expect(Object.keys(RECHECK_LINEAGE_TABLES).sort()).toEqual([
      "calculation_run",
      "corrective_signal",
      "data_quality_finding",
      "kpi_evaluation",
    ]);
    for (const t of Object.keys(RECHECK_LINEAGE_TABLES)) expect(RECHECK_OPERATIONAL_TABLES).not.toContain(t);
    expect(RECHECK_CHAIN_MAX_DEPTH).toBe(5);
    expect(RECHECK_LINEAGE_OUTBOX.map((o) => [o.eventType, o.aggregateType, o.keyPrefix, o.from])).toEqual([
      ["kpi.values_recalculated", "calculation_run", "kpi.values_recalculated:", "run"],
      ["kpi.deviation_evaluated", "kpi_evaluation", "kpi.deviation_evaluated:", "evaluation"],
    ]);
    expect(Object.keys(RECHECK_LINEAGE_TABLES.calculation_run.triggers).sort()).toEqual([
      "actual_accepted",
      "threshold_changed",
      "trajectory_approved",
      "version_activated",
    ]);
  });

  it("every named lineage link and column exists in the generated schema", () => {
    const schema = SCHEMA_COLUMNS as unknown as Record<string, readonly string[]>;
    for (const l of RECHECK_LINEAGE_LINKS)
      for (const c of l.columns) expect(schema[l.table], `${l.name} ${c}`).toContain(c);
    for (const [t, cols] of Object.entries(RECHECK_LINEAGE_COLUMNS))
      for (const c of cols) expect(schema[t], `${t}.${c}`).toContain(c);
  });
});
