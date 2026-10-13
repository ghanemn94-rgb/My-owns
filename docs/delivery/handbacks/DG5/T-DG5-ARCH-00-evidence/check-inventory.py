#!/usr/bin/env python3
"""Check p5-plan.md §1.2 against the register: every DG5 requirement mapped to exactly one slice (T-DG5-ARCH-00)."""
import collections, csv, re, sys

plan = open("docs/architecture/p5-plan.md", encoding="utf-8").read()
section = plan.split("### 1.2 Requirement → slice", 1)[1].split("### 1.3", 1)[0]
rows = re.findall(r"^\|\s*(REQ-[A-Z0-9-]+)\s*\|\s*([A-K])\s*\|", section, re.M)
ids = [r[0] for r in rows]
register = {r["req_id"] for r in csv.DictReader(open("docs/delivery/requirements.csv", encoding="utf-8")) if r["final_gate"] == "DG5"}
dups = [i for i, c in collections.Counter(ids).items() if c > 1]
missing, extra = sorted(register - set(ids)), sorted(set(ids) - register)
counts = collections.Counter(r[1] for r in rows)
for k in sorted(counts):
    print(f"{k} {counts[k]}")
print(f"total {len(ids)} register {len(register)} duplicates {dups} missing {missing} extra {extra}")
# The §1.3 check table must state the same per-slice counts and total.
table = plan.split("### 1.3 Check table", 1)[1].split("## 2.", 1)[0]
stated = {m[0]: int(m[1]) for m in re.findall(r"^\|\s*([A-K]) [^|]*\|\s*(\d+)\s*\|", table, re.M)}
total = re.search(r"\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*", table)
ok = not dups and not missing and not extra and len(ids) == len(register) == 78 and stated == dict(counts) and total and int(total.group(1)) == 78
print("check table matches" if stated == dict(counts) else f"check table MISMATCH {stated}")
print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
