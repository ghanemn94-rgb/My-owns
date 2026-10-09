#!/usr/bin/env python3
"""T-DG4-ARCH-00: check that docs/architecture/p4-plan.md §1.2 maps every DG4 requirement to exactly one slice.

Run from the repository root:  python3 -I docs/delivery/handbacks/DG4/T-DG4-ARCH-00-evidence/check-inventory.py
Exits 0 only when: the §1.2 ids equal the register's final_gate=DG4 ids, no id appears twice, every row names one
known slice, the per-slice counts equal the §1.3 check table, and the total is 137. It also checks that the
"Requirements covered" column of the §4 task table names every non-L requirement exactly once, in its own slice's task.
"""
import csv
import re
import sys
from collections import Counter

PLAN = "docs/architecture/p4-plan.md"
REGISTER = "docs/delivery/requirements.csv"
SLICES = "ABCDEFGHIJKL"

register = {r["req_id"] for r in csv.DictReader(open(REGISTER, encoding="utf-8")) if r["final_gate"] == "DG4"}
text = open(PLAN, encoding="utf-8").read()

def section(start, end):
    a = text.index(start)
    b = text.index(end, a)
    return text[a:b]

inv = section("### 1.2 Requirement → slice", "### 1.3 Check table")
rows = re.findall(r"^\| (REQ-[A-Z0-9-]+) \| ([A-Z]) \|", inv, flags=re.M)
ids = [r[0] for r in rows]
errors = []
dups = [k for k, v in Counter(ids).items() if v > 1]
if dups:
    errors.append(f"duplicate ids in §1.2: {dups}")
if set(ids) != register:
    errors.append(f"missing from §1.2: {sorted(register - set(ids))}; not DG4: {sorted(set(ids) - register)}")
bad = [r for r in rows if r[1] not in SLICES]
if bad:
    errors.append(f"unknown slice: {bad}")
slice_of = dict(rows)
counts = Counter(r[1] for r in rows)

check = section("### 1.3 Check table", "## 2.")
table = dict((m[0], int(m[1])) for m in re.findall(r"^\| ([A-L]) [^|]+\| (\d+) \|", check, flags=re.M))
total = re.search(r"\*\*Total\*\* \| \*\*(\d+)\*\*", check)
if table != dict(counts):
    errors.append(f"§1.3 counts {table} differ from §1.2 counts {dict(counts)}")
if not total or int(total.group(1)) != len(ids) or len(ids) != 137:
    errors.append(f"total: table {total.group(1) if total else None}, rows {len(ids)}, expected 137")

tasks = section("## 4. Architecture tasks", "**ADR numbers**")
covered = []
for line in tasks.splitlines():
    m = re.match(r"^\| \*\*(T-DG4-ARCH-\d+)\*\* \| ([A-L](?: \+ [A-L])?) \|", line)
    if not m:
        continue
    task_slices = set(m.group(2).replace(" ", "").split("+"))
    last = line.rstrip(" |").rsplit("|", 1)[1]
    for short in re.findall(r"\b((?:PB|S\d\d|DLV)-\d{3})\b(?!…)", last):
        rid = "REQ-" + short
        covered.append(rid)
        if slice_of.get(rid) not in task_slices:
            errors.append(f"{rid} listed under {m.group(1)} ({m.group(2)}) but mapped to slice {slice_of.get(rid)}")
# Range notation "S07-001…013" in the A row expands to the KPI rows 001..013 present in §1.2.
for line in tasks.splitlines():
    for pre, a, b in re.findall(r"(S\d\d)-(\d{3})…(\d{3})", line):
        for n in range(int(a), int(b) + 1):
            rid = f"REQ-{pre}-{n:03d}"
            if rid in slice_of:
                covered.append(rid)
non_l = {r for r, s in slice_of.items() if s != "L"}
cdups = [k for k, v in Counter(covered).items() if v > 1]
if cdups:
    errors.append(f"listed twice in §4: {cdups}")
if set(covered) != non_l:
    errors.append(f"§4 misses {sorted(non_l - set(covered))}; extra {sorted(set(covered) - non_l)}")

for s in SLICES:
    print(f"slice {s}: {counts.get(s, 0)}")
print(f"total: {len(ids)} (register DG4 rows: {len(register)}); §4 covers {len(set(covered))} non-L rows of {len(non_l)}")
if errors:
    print("FAIL"); [print(" -", e) for e in errors]; sys.exit(1)
print("PASS")
