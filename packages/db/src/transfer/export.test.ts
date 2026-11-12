// T-C2 (pure part; ADR-0064 §2.3, §4; p7-work-split §C.6): the encoder's line format. Every non-JSON value is a JSON
// string (never a JSON number), SQL NULL is null, json/jsonb text is embedded verbatim (no re-parse that could round a
// number), keys keep attribute order, booleans use boolout's t/f, and SecretRef columns are rewritten to provider
// "unbound" in SQL. The database round-trip through jsonb_populate_recordset is in
// test/integration/transfer-export.test.ts. Synthetic values only.
import { describe, expect, it } from "vitest";
import { columnExpression, columnKinds, confinedPath, encodeLine, ExportFailed } from "./export.ts";
import type { TransferPlanTable } from "./plan.ts";

describe("encodeLine (ADR-0064 §2.3)", () => {
  const cols = [
    { name: "id", kind: "text" as const },
    { name: "amount", kind: "text" as const },
    { name: "active", kind: "bool" as const },
    { name: "payload", kind: "json" as const },
    { name: "note", kind: "text" as const },
  ];

  it("writes text values as JSON strings in attribute order, null as null, json verbatim", () => {
    const line = encodeLine(cols, [
      "01920007-0000-7000-8000-000000000001",
      "12345678901234567890.1234",
      "t",
      '{"rate": 0.123456789012345678901234567890, "n": [1, 2]}',
      null,
    ]);
    expect(line).toBe(
      '{"id":"01920007-0000-7000-8000-000000000001","amount":"12345678901234567890.1234","active":"t",' +
        '"payload":{"rate": 0.123456789012345678901234567890, "n": [1, 2]},"note":null}',
    );
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["id", "amount", "active", "payload", "note"]);
    // No column value is a JSON number: decimals stay exact strings.
    for (const k of ["id", "amount", "active"]) expect(typeof parsed[k]).toBe("string");
    expect(line).not.toContain("\n");
  });

  it("escapes control characters and quotes in text so a line never breaks", () => {
    const line = encodeLine([{ name: "t", kind: "text" }], ['line 1\nline 2 "quoted" \\ تجريبي']);
    expect(line).not.toContain("\n");
    expect((JSON.parse(line) as { t: string }).t).toBe('line 1\nline 2 "quoted" \\ تجريبي');
  });
});

describe("columnExpression and columnKinds (ADR-0064 §2.3, §4)", () => {
  it("prints booleans with boolout's t/f and everything else through its text output", () => {
    expect(columnExpression("is_on", "bool")).toBe(`CASE WHEN "is_on" THEN 't' WHEN NOT "is_on" THEN 'f' END`);
    expect(columnExpression("amount", "text")).toBe(`"amount"::text`);
    expect(columnExpression('we"ird', "text")).toBe(`"we""ird"::text`);
  });

  it("rewrites a SecretRef's provider to unbound and keeps its name, for a single reference and a named object", () => {
    expect(columnExpression("credential_ref", "secret_ref")).toContain(
      `jsonb_set("credential_ref", '{provider}', '"unbound"')`,
    );
    const refs = columnExpression("credential_refs", "secret_refs");
    expect(refs).toContain('jsonb_each("credential_refs")');
    expect(refs).toContain(`jsonb_set(e.value, '{provider}', '"unbound"')`);
  });

  const table = (columns: { name: string; type: string }[]): TransferPlanTable => ({
    name: "storage_setting",
    loadPhase: 1,
    columns: columns.map((c) => ({ ...c, nullable: true })),
    primaryKey: ["id"],
    deferredColumns: [],
    selfReferences: [],
    deferrableForeignKeys: [],
  });

  it("classifies columns from the catalogue and the column rules", () => {
    const kinds = columnKinds(
      table([
        { name: "id", type: "uuid" },
        { name: "enabled", type: "bool" },
        { name: "settings", type: "jsonb" },
        { name: "s3_access_key_ref", type: "jsonb" },
        { name: "amount", type: "numeric" },
      ]),
      [{ table: "storage_setting", column: "s3_access_key_ref", rule: "secret_ref_unbind" }],
    );
    expect(kinds.map((k) => k.kind)).toEqual(["text", "bool", "json", "secret_ref", "text"]);
  });

  it("refuses a json column (raw newlines would break NDJSON) and a SecretRef rule on a non-jsonb column", () => {
    expect(() => columnKinds(table([{ name: "doc", type: "json" }]), [])).toThrow(ExportFailed);
    expect(() =>
      columnKinds(table([{ name: "ref", type: "text" }]), [
        { table: "storage_setting", column: "ref", rule: "secret_ref_unbind" },
      ]),
    ).toThrow(/not jsonb/);
  });
});

describe("confinedPath", () => {
  it("keeps every package path under its root", () => {
    expect(confinedPath("/srv/pkg", "tables/a.ndjson")).toBe("/srv/pkg/tables/a.ndjson");
    for (const bad of ["../x", "/etc/passwd", "tables/../../x", ""])
      expect(() => confinedPath("/srv/pkg", bad), bad).toThrow(ExportFailed);
  });
});
