# T-DG5-ARCH-03: generate the Kysely interfaces, Database lines, row types and SCHEMA_COLUMNS entries for the slice D/E
# tables from the migration DDL (0074-0076). Adapted from the T-DG5-ARCH-02 generator (adds the `time` type). Run from the repository root.
import re
M = ["packages/db/migrations/0074_p5_automation_engine.sql", "packages/db/migrations/0075_p5_starters_routes_policies.sql",
     "packages/db/migrations/0076_p5_automation_permissions.sql"]
sql = "\n".join(open(p).read() for p in M)
TYPES = {"uuid": "string", "text": "string", "smallint": "number", "integer": "number", "boolean": "boolean", "date": "string",
         "timestamptz": "TS", "jsonb": "JSON", "numeric": "string", "char": "string", "time": "string"}
tables = []
for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);", sql, re.S):
    name, body = m.group(1), m.group(2)
    cols = []
    for line in body.split("\n"):
        line = line.strip()
        cm = re.match(r"^([a-z_0-9]+)\s+(uuid|text|smallint|integer|boolean|date|timestamptz|jsonb|numeric|char|time)(\([0-9,]+\))?(\[\])?\s*(.*)$", line)
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
anchor = "export type MethodologyCoverageLinkRow = Selectable<MethodologyCoverageLinkTable>;\n"
assert s.count(anchor) == 1
block = ("\n// ---- P5 slices D and E (migrations 0074-0076; T-DG5-ARCH-03; ADR-0043, ADR-0044). Generated from the DDL by\n"
         "// docs/delivery/handbacks/DG5/T-DG5-ARCH-03-evidence/gen-schema.py.\n"
         + "\n".join(out_if) + "\nexport interface Database {\n" + "\n".join(out_db) + "\n}\n\n" + "\n".join(out_rows) + "\n")
s = s.replace(anchor, anchor + block, 1)
end = "} as const satisfies { readonly [T in keyof Database]: readonly (keyof Database[T] & string)[] };"
assert s.count(end) == 1
s = s.replace(end, "\n".join(out_cols) + "\n" + end, 1)
open(f, "w").write(s)
print(len(tables), "tables:", [t for t, _ in tables])
