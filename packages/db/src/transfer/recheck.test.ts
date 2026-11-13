// Unit parts of T-R7 and T-R15 (ADR-0064 A1.9, A2.6; p7-work-split §C.13; T-DG7-BE-R2): the constants' disjointness
// and coverage, and the structural allowance refusals (no database). Nothing here approves anything (no G1-G6, Finance
// or IT approval) or touches DG0-DG7.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALLOWANCE_SCHEMA_VERSION,
  AllowanceRefused,
  childrenOrder,
  isNeverOperational,
  parseAllowance,
  RECHECK_FINANCIAL_TABLES,
  RECHECK_NEVER_OPERATIONAL,
  RECHECK_OPERATIONAL_TABLES,
} from "./recheck.ts";

const bytes = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));
const base = (over: Record<string, unknown> = {}) => ({
  schemaVersion: ALLOWANCE_SCHEMA_VERSION,
  actors: [],
  tables: [],
  audited: [],
  children: [],
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

describe("parseAllowance (mth-recheck-allowance/2)", () => {
  it("accepts a well-formed file", () => {
    const a = parseAllowance(
      bytes(
        base({
          actors: [ACTOR],
          tables: [{ name: "transformation", added: [["a"]], changed: [] }],
          audited: [{ name: "gate_instance", mustInclude: { added: [], changed: [["b"]] } }],
          children: [{ name: "gate_instance_note", parent: "gate_instance", fkey: "gate_instance_note_fkey" }],
          operational: ["job_run"],
        }),
      ),
    );
    expect(a.tables[0]!.added).toEqual([["a"]]);
    expect(childrenOrder(a).map((c) => c.name)).toEqual(["gate_instance_note"]);
  });

  it("refuses each structural fault with its reason", () => {
    expect(refusal({ ...base(), schemaVersion: "mth-recheck-allowance/1" })).toBe(
      "unsupported schema version 'mth-recheck-allowance/1'",
    );
    for (const k of ["actors", "tables", "audited", "children", "operational"]) {
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
