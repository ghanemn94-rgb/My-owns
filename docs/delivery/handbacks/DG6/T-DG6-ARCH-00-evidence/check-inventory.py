#!/usr/bin/env python3
"""Check p6-plan.md §1.2 against the register: every DG6 requirement mapped to exactly one slice (T-DG6-ARCH-00)."""
import collections, csv, re, sys

plan = open("docs/architecture/p6-plan.md", encoding="utf-8").read()
section = plan.split("### 1.2 Requirement → slice", 1)[1].split("### 1.3", 1)[0]
rows = re.findall(r"^\|\s*(REQ-[A-Z0-9-]+)\s*\|\s*([A-L])\s*\|\s*(Met|Partly|New)\s*\|", section, re.M)
ids = [r[0] for r in rows]
register = {r["req_id"] for r in csv.DictReader(open("docs/delivery/requirements.csv", encoding="utf-8")) if r["final_gate"] == "DG6"}
dups = [i for i, c in collections.Counter(ids).items() if c > 1]
missing, extra = sorted(register - set(ids)), sorted(set(ids) - register)
counts = collections.Counter(r[1] for r in rows)
status = collections.Counter(r[2] for r in rows)
for k in "ABCDEFGHIJKL":
    print(f"{k} {counts.get(k, 0)}")
print(f"status {dict(sorted(status.items()))}")
print(f"total {len(ids)} register {len(register)} duplicates {dups} missing {missing} extra {extra}")
# The §1.3 check table must state the same per-slice counts (zero rows included) and the total.
table = plan.split("### 1.3 Check table", 1)[1].split("### 1.4", 1)[0]
stated = {m[0]: int(m[1]) for m in re.findall(r"^\|\s*([A-L]) [^|]*\|\s*(\d+)\s*\|", table, re.M)}
expected = {k: counts.get(k, 0) for k in "ABCDEFGHIJKL"}
total = re.search(r"\*\*Total\*\*\s*\|\s*\*\*(\d+)\*\*", table)
st = re.search(r"Status totals: Met (\d+), Partly (\d+), New (\d+)\.", table)
status_ok = bool(st) and (int(st.group(1)), int(st.group(2)), int(st.group(3))) == (status.get("Met", 0), status.get("Partly", 0), status.get("New", 0))
ok = (not dups and not missing and not extra and len(ids) == len(register) == 48 and stated == expected
      and total and int(total.group(1)) == 48 and status_ok)
print("check table matches" if stated == expected else f"check table MISMATCH {stated}")
print("status totals match" if status_ok else "status totals MISMATCH")
print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
