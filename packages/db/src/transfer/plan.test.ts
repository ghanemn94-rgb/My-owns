// T-C1 (pure part; ADR-0064 §2.2; p7-work-split §C.6): the planner breaks multi-table cycles only with nullable edges
// (created_by/updated_by first), fails a cycle no nullable edge breaks with the C.5 line, orders every referenced
// table before its referencing table (ties by name), and orders self-referencing rows by depth. The real schema's plan
// is checked in test/integration/transfer-export.test.ts. Synthetic table names only.
import { describe, expect, it } from "vitest";
import {
  orderTables,
  selfReferenceOrder,
  stronglyConnected,
  TransferPlanError,
  type TransferForeignKey,
} from "./plan.ts";

const fk = (
  table: string,
  columns: string[],
  referencedTable: string,
  nullable = true,
  extra: Partial<TransferForeignKey> = {},
): TransferForeignKey => ({
  name: `${table}_${columns.join("_")}_fkey`,
  table,
  columns,
  referencedTable,
  referencedColumns: ["id"],
  nullable,
  nullableColumns: nullable ? columns : [],
  deferrable: false,
  ...extra,
});

describe("orderTables (ADR-0064 §2.2)", () => {
  it("loads a referenced table first; ties by code point order; self-references are not edges", () => {
    const { order, deferred } = orderTables(
      ["c", "b", "a", "z"],
      [
        fk("c", ["b_id"], "b", false),
        fk("b", ["a_id"], "a", false),
        fk("z", ["parent_id"], "z"),
        fk("a", ["x"], "outside"),
      ],
    );
    expect(order).toEqual(["a", "b", "c", "z"]);
    expect(deferred.size).toBe(0);
  });

  it("breaks the organization/app_user cycle with created_by before any other nullable column", () => {
    const { order, deferred } = orderTables(
      ["organization", "app_user"],
      [
        fk("app_user", ["organization_id"], "organization", false),
        fk("organization", ["created_by"], "app_user"),
        fk("organization", ["default_owner_id"], "app_user"),
      ],
    );
    // created_by alone does not break the cycle (default_owner_id still closes it): the second pass defers it too.
    expect(deferred.get("organization")).toEqual(["created_by", "default_owner_id"]);
    expect(order).toEqual(["organization", "app_user"]);
  });

  it("defers only the audit-stamp edges when they suffice", () => {
    const { deferred } = orderTables(
      ["a", "b"],
      [fk("a", ["b_id"], "b"), fk("b", ["a_id"], "a", false), fk("a", ["updated_by"], "b")],
    );
    // updated_by first; then a.b_id (nullable) is still needed, because b.a_id is NOT NULL.
    expect(deferred.get("a")).toEqual(["b_id", "updated_by"]);
    expect(deferred.has("b")).toBe(false);
    const stamped = orderTables(["a", "b"], [fk("a", ["created_by"], "b"), fk("b", ["a_id"], "a", false)]);
    expect(stamped.deferred.get("a")).toEqual(["created_by"]);
    expect(stamped.order).toEqual(["a", "b"]);
  });

  it("breaks a composite MATCH SIMPLE key by nulling only its nullable column", () => {
    // decision_option (transformation_id, decision_id) NOT NULL -> decision; decision (id, chosen_option_id?) -> option.
    const { order, deferred } = orderTables(
      ["decision", "decision_option"],
      [
        fk("decision_option", ["transformation_id", "decision_id"], "decision", false),
        fk("decision", ["id", "chosen_option_id"], "decision_option", true, { nullableColumns: ["chosen_option_id"] }),
      ],
    );
    expect(deferred.get("decision")).toEqual(["chosen_option_id"]);
    expect(order).toEqual(["decision", "decision_option"]);
  });

  it("removes a DEFERRABLE all-NOT-NULL key from the order only when nothing nullable breaks the cycle", () => {
    const { order, deferred, deferrable } = orderTables(
      ["connector", "connector_config_version"],
      [
        fk("connector_config_version", ["connector_id"], "connector", false),
        fk("connector", ["id", "config_version_no"], "connector_config_version", false, { deferrable: true }),
      ],
    );
    expect(deferrable.get("connector")).toEqual(["connector_id_config_version_no_fkey"]);
    expect(deferred.size).toBe(0);
    expect(order).toEqual(["connector", "connector_config_version"]);
  });

  it("fails a cycle no nullable edge breaks, with the exact C.5 line", () => {
    const run = () =>
      orderTables(
        ["b", "a", "c"],
        [fk("a", ["b_id"], "b", false), fk("b", ["a_id"], "a", false), fk("c", ["a_id"], "a")],
      );
    expect(run).toThrow(TransferPlanError);
    expect(run).toThrow("migration plan: foreign-key cycle without a nullable edge: a, b");
  });

  it("finds strongly connected components deterministically", () => {
    const comps = stronglyConnected(
      ["a", "b", "c", "d"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
        { from: "c", to: "d" },
      ],
    );
    expect(comps.filter((c) => c.length > 1)).toEqual([["a", "b"]]);
  });
});

describe("selfReferenceOrder (T-C1: a synthetic depth-3 self-reference loads in order)", () => {
  it("orders rows by self-reference depth, then by their given (primary key) order", () => {
    // ids sort root-last on purpose: the primary-key order would put a child before its parent.
    const rows = [
      { id: "1", parent: "2" }, // depth 3
      { id: "2", parent: "3" }, // depth 2
      { id: "3", parent: "9" }, // depth 1
      { id: "4", parent: null }, // depth 0
      { id: "9", parent: null }, // depth 0
    ];
    const ordered = selfReferenceOrder(
      rows,
      (r) => r.id,
      (r) => [r.parent],
    );
    expect(ordered.map((r) => r.id)).toEqual(["4", "9", "3", "2", "1"]);
    const seen = new Set<string>();
    for (const r of ordered) {
      if (r.parent !== null) expect(seen.has(r.parent), r.id).toBe(true);
      seen.add(r.id);
    }
  });
});
