#!/usr/bin/env python3
"""qa-verifier DG4 round 8: confirmation of the 137 DG4-final register rows on the frozen candidate clone.
Checks: the assigned id list == the register's DG4-final rows; every row is IMPLEMENTED; every evidence path
in the row exists in the candidate clone. Usage: req-check.py <clone> <assignment.md>"""
import csv,re,sys,os
clone,asg=sys.argv[1],sys.argv[2]
assigned=re.findall(r"`(REQ-[A-Z0-9]+-\d+)`", open(asg).read().split("## Requirements to check")[1].split("## Evidence honesty")[0])
rows=[r for r in csv.DictReader(open(os.path.join(clone,"docs/delivery/requirements.csv"),encoding="utf-8")) if r.get("final_gate")=="DG4"]
ids=[r["id"] for r in rows] if "id" in rows[0] else [r[list(r)[0]] for r in rows]
print("assigned ids:",len(assigned),"unique:",len(set(assigned)))
print("register DG4-final rows:",len(rows))
print("assigned == register DG4-final set:",set(assigned)==set(ids))
st={};missing=[];npaths=0
for r in rows:
    st[r["status"]]=st.get(r["status"],0)+1
    for p in re.split(r"[;\s]+", r.get("evidence","")):
        p=p.strip().split("#")[0]
        if not p or "/" not in p: continue
        npaths+=1
        if not os.path.exists(os.path.join(clone,p)): missing.append((r["id"],p))
print("status counts:",st)
print("evidence paths checked:",npaths,"missing in candidate clone:",len(missing))
for m in missing: print("  MISSING",m)
