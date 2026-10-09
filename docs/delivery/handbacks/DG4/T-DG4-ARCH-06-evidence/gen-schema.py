# T-DG4-ARCH-06: generate the Kysely interfaces, Database lines, row types and SCHEMA_COLUMNS entries for the slice F
# and G tables from the migration DDL (0047, 0048), so packages/db/src/schema.ts matches the migrations column for
# column. Also lists the columns 0048 adds to initiative. Run from the repository root: python3 gen-schema.py <out>.
import re, sys
M = ["packages/db/migrations/0047_p4_adoption.sql", "packages/db/migrations/0048_p4_sustainment.sql"]
sql = "\n".join(open(p).read() for p in M)
TYPES = {"uuid": "string", "text": "string", "smallint": "number", "integer": "number", "boolean": "boolean", "date": "string",
         "timestamptz": "TS", "jsonb": "JSON", "tsvector": "TSV"}
tables = []
for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);", sql, re.S):
    name, body = m.group(1), m.group(2)
    cols = []
    for line in body.split("\n"):
        line = line.strip()
        cm = re.match(r"^([a-z_0-9]+)\s+(uuid|text|smallint|integer|boolean|date|timestamptz|jsonb|tsvector)(\[\])?\s*(.*)$", line)
        if not cm or cm.group(1) in ("constraint",):
            continue
        col, typ, arr, rest = cm.groups()
        notnull = rest.startswith("NOT NULL") or rest.startswith("PRIMARY KEY")
        default = "DEFAULT" in rest.split("CHECK")[0].split("REFERENCES")[0]
        base = TYPES[typ]
        if base == "TSV":
            t = "ColumnType<string, never, never>"
        elif base == "JSON":
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
ini = re.search(r"ALTER TABLE initiative\n(.*?);\n", sql, re.S).group(1)
add = re.findall(r"ADD COLUMN (\w+)", ini)
open(sys.argv[1], "w").write("\n".join(out_if) + "\n@@DB\n" + "\n".join(out_db) + "\n@@ROWS\n" + "\n".join(out_rows) + "\n@@COLS\n" + "\n".join(out_cols) + "\n@@INI\n" + ",".join(add) + "\n")
print(len(tables), "tables;", "initiative +", add)
