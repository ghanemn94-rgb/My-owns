# T-DG5-ARCH-01: generate the Kysely interfaces, Database lines, row types and SCHEMA_COLUMNS entries for the slice A
# tables from the migration DDL (0055, 0056), the two views, and the columns 0055 adds to initiative_outcome_contribution.
# Adapted from the T-DG4-ARCH-07 generator. Run from the repository root.
import re
M = ["packages/db/migrations/0062_p5_config_versions.sql", "packages/db/migrations/0063_p5_pins_methodology_migrations.sql"]
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
anchor = "export type MyWorkDraftRow = Selectable<MyWorkDraftView>;\n"
assert s.count(anchor) == 1
block = ("\n// ---- P5 slice A (migrations 0062-0063; T-DG5-ARCH-01; ADR-0039, ADR-0040). Generated from the DDL by\n"
         "// docs/delivery/handbacks/DG5/T-DG5-ARCH-01-evidence/gen-schema.py. numeric -> string (decimal).\n"
         + "\n".join(out_if) + "\nexport interface Database {\n" + "\n".join(out_db) + "\n}\n\n" + "\n".join(out_rows) + "\n")
s = s.replace(anchor, anchor + block, 1)
end = "} as const satisfies { readonly [T in keyof Database]: readonly (keyof Database[T] & string)[] };"
assert s.count(end) == 1
s = s.replace(end, "\n".join(out_cols) + "\n" + end, 1)
# Columns 0062/0063 add to two DG2 tables.
old = "  published_by: string | null;\n  version: Generated<number>;\n  created_at: TimestampDefault;\n  created_by: string | null;\n  updated_at: TimestampDefault;\n  updated_by: string | null;\n}\n\nexport interface TransformationConfigPinTable {"
assert s.count(old) == 1
s = s.replace(old, old.replace("  published_by: string | null;\n", "  published_by: string | null;\n  /** 0062 (ADR-0039 §1): the Studio configuration kind, draft stage, origin and lineage. */\n  config_kind: Generated<string>;\n  draft_stage: string | null;\n  origin: Generated<string>;\n  based_on_version_id: string | null;\n  rollback_of_version_id: string | null;\n  change_summary: string | null;\n  discarded_at: NullableTimestamp;\n"), 1)
old = "  methodology_version_id: string;\n  pinned_at: TimestampDefault;\n  pinned_by: string;\n"
assert s.count(old) == 1
s = s.replace(old, old + "  /** 0063 (ADR-0040 §1): the approved migration that last moved this pin; NULL = never moved. */\n  last_migration_id: string | null;\n", 1)
def addcols(s, table, after, new):
    i = s.index(f"  {table}: [\n", s.index("export const SCHEMA_COLUMNS"))
    j = s.index("  ],", i)
    blk = s[i:j]
    k = blk.index(f'    "{after}",\n') + len(f'    "{after}",\n')
    blk = blk[:k] + "".join(f'    "{c}",\n' for c in new) + blk[k:]
    return s[:i] + blk + s[j:]
s = addcols(s, "methodology_version", "published_by", ["config_kind", "draft_stage", "origin", "based_on_version_id", "rollback_of_version_id", "change_summary", "discarded_at"])
s = addcols(s, "transformation_config_pin", "pinned_by", ["last_migration_id"])
open(f, "w").write(s)
print(len(tables), "tables:", [t for t, _ in tables])
