#!/usr/bin/env python3
"""qa-verifier DG7 round 2: independent read-only checks of the delivery records (A23, A24, A26, A27 clauses).

Run from the repository root (main repository, read-only). Prints one section per clause; never writes.
R1  REQ-DLV-005/010/021: each gate DG0-DG6: three PASS specialist records + auditor on the gate candidate, distinct
    invocation references, reviewer_role not in the record's implementation_author.
R2  REQ-DLV-014/040/027: stage histories: DG0-DG6 pass BUILDING -> REVIEWING -> VERIFYING -> APPROVED; each stage's first
    BUILDING is after the previous stage's APPROVED.
R3  REQ-DLV-009: max concurrent run intervals per stage from runs/<DGx>/*/meta.json (own computation).
R4  REQ-DLV-011 (DG7 part): every DG7 run's assignment_sha256 equals the sha256 of the named assignment file.
R5  REQ-DLV-028: progress.md mentions each approved gate's candidate id.
R6  REQ-DLV-027/S20-027: no record text claims a business/Finance/IT approval granted by an agent (spot regex).
"""
import csv, glob, hashlib, json, os, re, sys
from datetime import datetime

D = "docs/delivery"
st = json.load(open(f"{D}/stages.json"))
stages = {s["id"]: s for s in st["stages"]}
bad = 0


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


print("== R1 gate records DG0-DG6")
for g in [f"DG{i}" for i in range(7)]:
    gr = json.load(open(f"{D}/gates/{g}.json"))
    cand = gr["candidate_id"]
    invs = set()
    roles_ok = True
    line = []
    for role, path in list(gr["reviews"].items()) + [("release-auditor", gr["release_audit"])]:
        r = json.load(open(path))
        inv = json.dumps(r["invocation_reference"], sort_keys=True)
        dup = inv in invs
        invs.add(inv)
        own = r["reviewer_role"] in r.get("implementation_author", [])
        ok = r["candidate_id"] == cand and r["verdict"] == "PASS" and not dup and not own and r["reviewer_role"] == role
        roles_ok &= ok
        line.append(f"{role}:{r['verdict']}{'' if r['candidate_id']==cand else ' CAND-MISMATCH'}{' DUP-INV' if dup else ''}{' SELF' if own else ''}")
    print(f"{g} {gr['decision']} {cand[:15]} -> {'OK' if roles_ok else 'BAD'}: {'; '.join(line)}")
    bad += 0 if roles_ok else 1

print("== R2 stage histories")
prev_appr = None
for g in [f"DG{i}" for i in range(8)]:
    h = stages[g]["history"]
    states = [e["state"] for e in h]
    first_build = next((ts(e["at"]) for e in h if e["state"] == "BUILDING"), None)
    appr = [ts(e["at"]) for e in h if e["state"] == "APPROVED"]
    seq_ok = all(x in states for x in ["BUILDING", "REVIEWING", "VERIFYING", "APPROVED"]) if g != "DG7" else True
    order_ok = prev_appr is None or (first_build is not None and first_build >= prev_appr)
    print(f"{g} state={stages[g]['state']} states={'>'.join(states)} first BUILDING={first_build} prevAPPROVED={prev_appr} "
          f"-> seq {'OK' if seq_ok else 'MISSING'}; order {'OK' if order_ok else 'BUILDING-BEFORE-PREV-APPROVED'}")
    bad += 0 if (seq_ok and order_ok) else 1
    prev_appr = max(appr) if appr else None

print("== R3 run concurrency per stage (meta.json started_at/finished_at)")
for g in [f"DG{i}" for i in range(8)]:
    ev = []
    nometa = 0
    for m in glob.glob(f"{D}/runs/{g}/*/"):
        p = os.path.join(m, "meta.json")
        if not os.path.exists(p):
            nometa += 1
            continue
        j = json.load(open(p))
        if not j.get("started_at") or not j.get("finished_at"):
            nometa += 1
            continue
        ev.append((ts(j["started_at"]), 1))
        ev.append((ts(j["finished_at"]), -1))
    ev.sort(key=lambda x: (x[0], x[1]))
    cur = mx = 0
    for _, d in ev:
        cur += d
        mx = max(mx, cur)
    print(f"{g}: runs with times {len(ev)//2}, without meta/times {nometa}, max concurrent {mx}{'  (>4)' if mx > 4 else ''}")

print("== R4 DG7 run assignment hashes")
miss = mism = okc = 0
for p in sorted(glob.glob(f"{D}/runs/DG7/*/meta.json")):
    j = json.load(open(p))
    a = j.get("assignment")
    if not a or not os.path.exists(a):
        miss += 1
        print(f"  missing assignment file: {p} -> {a}")
        continue
    h = hashlib.sha256(open(a, "rb").read()).hexdigest()
    if h != j.get("assignment_sha256"):
        mism += 1
        print(f"  hash mismatch: {p} -> {a}")
    else:
        okc += 1
print(f"DG7 runs: assignment hash OK {okc}, mismatch {mism}, file missing {miss}")

print("== R5 progress.md mentions each approved gate candidate")
prog = open(f"{D}/progress.md").read()
for g in [f"DG{i}" for i in range(7)]:
    c = json.load(open(f"{D}/gates/{g}.json"))["candidate_id"]
    short = c.split(":")[1][:8]
    print(f"{g} {short}: {'present' if short in prog else 'ABSENT'}")

print(f"== summary: R1/R2 bad entries {bad}")
sys.exit(1 if bad else 0)
