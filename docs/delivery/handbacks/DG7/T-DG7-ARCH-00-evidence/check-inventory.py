#!/usr/bin/env python3
"""Check docs/architecture/p7-plan.md §1.2/§1.3 against the register (T-DG7-ARCH-00).

- every DG7 requirement of docs/delivery/requirements.csv appears exactly once in the §1.2 table;
- no other id appears there; each row names one slice letter of §1.1 and a status Met/Partly/New;
- the per-slice counts equal the §1.3 check table, whose total is 54.
Exit 0 on success, 1 on any mismatch.
"""
import csv, re, sys
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parents[5]
plan = (root / "docs/architecture/p7-plan.md").read_text(encoding="utf-8")
reg = [r for r in csv.DictReader(open(root / "docs/delivery/requirements.csv", encoding="utf-8")) if r["final_gate"] == "DG7"]
want = {r["req_id"] for r in reg}

sec12 = plan.split("### 1.2", 1)[1].split("### 1.3", 1)[0]
sec13 = plan.split("### 1.3", 1)[1].split("### 1.4", 1)[0]
rows = re.findall(r"^\| (REQ-[A-Z0-9]+-\d{3}) \| ([A-N])\s+\| (Met|Partly|New)\s+\|", sec12, re.M)
errors = []
ids = [r[0] for r in rows]
dup = [i for i, n in Counter(ids).items() if n > 1]
if dup: errors.append(f"duplicate ids: {dup}")
if set(ids) - want: errors.append(f"not DG7 rows: {sorted(set(ids) - want)}")
if want - set(ids): errors.append(f"missing: {sorted(want - set(ids))}")
per = Counter(r[1] for r in rows)
table = {m.group(1): int(m.group(2)) for m in re.finditer(r"^\| ([A-N]) [^|]*\| (\d+)\s+\|", sec13, re.M)}
total = re.search(r"\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*", sec13)
for s in sorted(set(table) | set(per)):
    if table.get(s, 0) != per.get(s, 0): errors.append(f"slice {s}: table {table.get(s, 0)} != mapped {per.get(s, 0)}")
if not total or int(total.group(1)) != len(want) or sum(table.values()) != len(want):
    errors.append(f"total: table says {total and total.group(1)}, sum {sum(table.values())}, register {len(want)}")
status = Counter(r[2] for r in rows)
print(f"register DG7 rows: {len(want)}; mapped rows: {len(rows)}; unique: {len(set(ids))}")
print("per slice:", dict(sorted(per.items())), "sum", sum(per.values()))
print("status:", dict(status))
for e in errors: print("ERROR", e)
print("PASS" if not errors else "FAIL")
sys.exit(1 if errors else 0)
