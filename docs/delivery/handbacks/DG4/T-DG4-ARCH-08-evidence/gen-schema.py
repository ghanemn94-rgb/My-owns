# T-DG4-ARCH-08: generate the Kysely interfaces, Database lines, row types and SCHEMA_COLUMNS entries for the slices J+K
# tables from the migration DDL (0055, 0056), the two views, and the columns 0055 adds to initiative_outcome_contribution.
# Adapted from the T-DG4-ARCH-07 generator. Run from the repository root.
import re
M = ["packages/db/migrations/0055_p4_traceability_modular_structure.sql", "packages/db/migrations/0056_p4_dashboards_t10.sql"]
sql = "\n".join(open(p).read() for p in M)
TYPES = {"uuid": "string", "text": "string", "smallint": "number", "integer": "number", "boolean": "boolean", "date": "string",
         "timestamptz": "TS", "jsonb": "JSON", "numeric": "string", "char": "string"}
tables = []
for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);", sql, re.S):
    name, body = m.group(1), m.group(2)
    cols = []
    for line in body.split("\n"):
        line = line.strip()
        cm = re.match(r"^([a-z_0-9]+)\s+(uuid|text|smallint|integer|boolean|date|timestamptz|jsonb|numeric|char)(\([0-9,]+\))?(\[\])?\s*(.*)$", line)
        if not cm or cm.group(1) in ("constraint",):
            continue
        col, typ, _prec, arr, rest = cm.groups()
        notnull = rest.startswith("NOT NULL") or rest.startswith("PRIMARY KEY")
        default = "DEFAULT" in rest.split("CHECK")[0].split("REFERENCES")[0]
        base = TYPES[typ]
        if base == "JSON":
            t = ("JsonDefault" if default else "Json") if notnull else "NullableJson"
        elif base == "TS":
            t = ("TimestampDefault" if default else "Timestamp") if notnull else "NullableTimestamp"
        else:
            if arr:
                base = base + "[]"
            t = base if notnull else f"{base} | null"
            if default and notnull:
                t = f"Generated<{base}>"
        cols.append((col, t))
    tables.append((name, cols))
def pascal(n): return "".join(w.capitalize() for w in n.split("_"))
out_if, out_db, out_rows, out_cols = [], [], [], []
for name, cols in tables:
    out_if.append(f"export interface {pascal(name)}Table {{\n" + "".join(f"  {c}: {t};\n" for c, t in cols) + "}\n")
    out_db.append(f"  {name}: {pascal(name)}Table;")
    out_rows.append(f"export type {pascal(name)}Row = Selectable<{pascal(name)}Table>;")
    out_cols.append(f"  {name}: [\n" + "".join(f'    "{c}",\n' for c, _ in cols) + "  ],")
f = "packages/db/src/schema.ts"
s = open(f).read()
anchor = "export type ImpactAssessmentItemRow = Selectable<ImpactAssessmentItemTable>;\n"
assert s.count(anchor) == 1
block = ("\n// ---- P4 slices J and K (migrations 0055-0056; T-DG4-ARCH-08; ADR-0037, ADR-0038). Generated from the DDL by\n"
         "// docs/delivery/handbacks/DG4/T-DG4-ARCH-08-evidence/gen-schema.py. numeric -> string (decimal), date -> \"YYYY-MM-DD\".\n"
         + "\n".join(out_if) + "\nexport interface Database {\n" + "\n".join(out_db) + "\n}\n\n" + "\n".join(out_rows) + "\n")
s = s.replace(anchor, anchor + block, 1)
end = "} as const satisfies { readonly [T in keyof Database]: readonly (keyof Database[T] & string)[] };"
assert s.count(end) == 1
s = s.replace(end, "\n".join(out_cols) + "\n" + end, 1)
VIEWS = {
    "traceability_edge": [("organization_id", "string"), ("transformation_id", "string"), ("edge_kind", "string"), ("from_type", "string"),
                          ("from_id", "string"), ("to_type", "string"), ("to_id", "string"), ("link_table", "string"), ("link_id", "string"),
                          ("contribution_statement", "string"), ("allocation_share", "string")],
    "my_work_draft": [("organization_id", "string"), ("transformation_id", "string"), ("record_type", "string"), ("record_id", "string"),
                      ("code", "string"), ("label", "string"), ("parent_type", "string"), ("parent_id", "string"), ("created_by", "string"),
                      ("updated_at", "Date")],
}
vif = "".join(f"/** View (0055/0056; read-only). */\nexport interface {pascal(v)}View {{\n" + "".join(f"  {c}: ColumnType<{t} | null, never, never>;\n" for c, t in cols) + "}\n\n" for v, cols in VIEWS.items())
vdb = "export interface Database {\n" + "".join(f"  {v}: {pascal(v)}View;\n" for v in VIEWS) + "}\n\n"
vrows = "".join(f"export type {pascal(v)}Row = Selectable<{pascal(v)}View>;\n" for v in VIEWS)
first_row = "\n".join(out_rows) + "\n"
assert s.count(first_row) == 1
s = s.replace(first_row, first_row + "\n" + vif + vdb + vrows, 1)
s = s.replace(end, "\n".join(f"  {v}: [\n" + "".join(f'    "{c}",\n' for c, _ in cols) + "  ]," for v, cols in VIEWS.items()) + "\n" + end, 1)
old_vn = '  "scope_node",\n] as const;'
assert s.count(old_vn) == 1
s = s.replace(old_vn, '  "my_work_draft",\n  "scope_node",\n  "traceability_edge",\n] as const;', 1)
old_if = "  contribution_statement: string;\n  expected_kpi_movement: string | null;\n  status: Generated<string>;\n"
assert s.count(old_if) == 1
s = s.replace(old_if, old_if + "  /** 0055 (ADR-0038 §2): share of the KPI movement credited to this contribution (0 < share <= 1); NULL = none. */\n  allocation_share: string | null;\n  allocation_basis: string | null;\n", 1)
i = s.index("  initiative_outcome_contribution: [\n")
j = s.index("  ],", i)
cols_block = s[i:j]
assert '"updated_by",\n' in cols_block
s = s[:i] + cols_block + '    "allocation_share",\n    "allocation_basis",\n' + s[j:]
open(f, "w").write(s)
print(len(tables), "tables:", [t for t, _ in tables], "views:", list(VIEWS))
