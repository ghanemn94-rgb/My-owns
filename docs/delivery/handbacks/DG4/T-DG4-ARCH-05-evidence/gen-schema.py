# T-DG4-ARCH-05: generate the Kysely interfaces and SCHEMA_COLUMNS entries for the slice D tables from the migration DDL
# (0044, 0045), so packages/db/src/schema.ts matches the migrations column for column. Run from the repository root.
import re, sys
M = ["packages/db/migrations/0044_p4_forums_meetings.sql", "packages/db/migrations/0045_p4_t16_escalation.sql"]
sql = "\n".join(open(p).read() for p in M)
tables = []
for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);", sql, re.S):
    name, body = m.group(1), m.group(2)
    cols = []
    for line in body.split("\n"):
        line = line.strip()
        cm = re.match(r"^([a-z_0-9]+)\s+(uuid|text|smallint|integer|boolean|date|time|timestamptz)(\[\])?\s+(.*)$", line)
        if not cm or cm.group(1) in ("constraint",):
            continue
        col, typ, arr, rest = cm.groups()
        notnull = rest.startswith("NOT NULL") or rest.startswith("PRIMARY KEY")
        default = "DEFAULT" in rest.split("CHECK")[0].split("REFERENCES")[0]
        base = {"uuid": "string", "text": "string", "smallint": "number", "integer": "number", "boolean": "boolean", "date": "string", "time": "string", "timestamptz": "TS"}[typ]
        if arr:
            base = base + "[]"
        if base == "TS":
            t = ("TimestampDefault" if default else "Timestamp") if notnull else "NullableTimestamp"
        else:
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
# decision columns added by 0045
dec = re.search(r"ALTER TABLE decision\n(.*?);\n", sql, re.S).group(1)
add = []
for cm in re.finditer(r"ADD COLUMN (\w+)\s+(uuid|text|date)\s+NULL", dec):
    add.append(cm.group(1))
# view
v = re.search(r"CREATE VIEW executive_decision_log AS\n(.*?)\nFROM decision d", sql, re.S).group(1)
vcols = []
for part in re.split(r",\s*\n\s*|,\s+(?=d\.)", v.replace("SELECT ", "", 1)):
    part = part.strip()
    am = re.search(r"AS (\w+)$", part)
    if am: vcols.append(am.group(1)); continue
    for x in re.findall(r"d\.(\w+)", part): vcols.append(x)
seen = []
for c in vcols:
    if c not in seen and c != "recommendation_option_id": seen.append(c)  # the subquery's column is not a view column
open(sys.argv[1], "w").write("\n".join(out_if) + "\n@@DB\n" + "\n".join(out_db) + "\n@@ROWS\n" + "\n".join(out_rows) + "\n@@COLS\n" + "\n".join(out_cols) + "\n@@DEC\n" + ",".join(add) + "\n@@VIEW\n" + ",".join(seen) + "\n")
