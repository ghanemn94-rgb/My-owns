# qa-verifier DG6 round 4: F-DG6-260 check. For the four rows, at a given revision, list each stale phrase of round 3
# and whether a later "[T-DG6-AN-Z2: ... superseded" marker and a T-DG6-AN-Z2 check follow it in the same note.
# Usage: python3 f260-register-notes-check.py <rev>...   Exit 1 if any stale phrase is not superseded.
import csv, io, subprocess, sys
ROWS = ["REQ-S20-001", "REQ-S20-012", "REQ-S20-017", "REQ-S20-022"]
STALE = ["not yet in this tree", "still fails", "not fully green", "is unrepaired in this tree", "is still to be recorded"]
bad_total = 0
for rev in sys.argv[1:]:
    t = subprocess.run(["git", "show", f"{rev}:docs/delivery/requirements.csv"], capture_output=True, text=True, check=True).stdout
    rows = {r["req_id"]: r for r in csv.DictReader(io.StringIO(t))}
    for rid in ROWS:
        n = rows[rid]["notes"]
        for p in STALE:
            i = n.find(p)
            if i < 0: continue
            after = n[i:]
            sup = "superseded by the check below" in after and "DG6 analyst check (T-DG6-AN-Z2" in after
            bad_total += 0 if sup else 1
            print(f"{rev[:10]} {rid}: '{p}' at {i}: {'SUPERSEDED by a later T-DG6-AN-Z2 check' if sup else 'STALE (no later check)'}")
        print(f"{rev[:10]} {rid}: AN-Z2 check present: {'DG6 analyst check (T-DG6-AN-Z2' in n}; status {rows[rid]['status']}")
print(f"stale-unsuperseded={bad_total}")
sys.exit(1 if bad_total else 0)
