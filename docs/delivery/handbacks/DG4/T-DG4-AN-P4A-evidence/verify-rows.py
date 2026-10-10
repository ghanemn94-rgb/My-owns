# Usage (repo root): python3 -I docs/delivery/handbacks/DG4/T-DG4-AN-P4A-evidence/verify-rows.py
# Compares the working requirements.csv with HEAD's: CSV integrity, and that only T-DG4-AN-P4A's 71 rows changed,
# and only in status/evidence/notes.
import csv, io, os, subprocess
from collections import Counter
MINE = set("""REQ-PB-005 REQ-PB-008 REQ-PB-009 REQ-PB-010 REQ-PB-013 REQ-PB-014 REQ-PB-015 REQ-PB-020 REQ-PB-021
REQ-PB-044 REQ-PB-058 REQ-PB-060 REQ-PB-061 REQ-PB-062 REQ-PB-063 REQ-PB-064 REQ-PB-065 REQ-PB-066 REQ-PB-067
REQ-PB-068 REQ-PB-069 REQ-PB-070 REQ-PB-071 REQ-PB-072 REQ-PB-073 REQ-PB-074 REQ-PB-075 REQ-PB-076 REQ-PB-078
REQ-PB-079 REQ-PB-080 REQ-PB-081 REQ-PB-082 REQ-PB-083 REQ-PB-084 REQ-PB-085 REQ-DLV-036 REQ-S03-001 REQ-S03-002
REQ-S03-003 REQ-S03-004 REQ-S03-005 REQ-S03-006 REQ-S03-008 REQ-S03-009 REQ-S03-011 REQ-S04-001 REQ-S04-002
REQ-S04-007 REQ-S04-008 REQ-S04-009 REQ-S04-010 REQ-S04-012 REQ-S04-013 REQ-S04-014 REQ-S07-001 REQ-S07-002
REQ-S07-003 REQ-S07-004 REQ-S07-005 REQ-S07-006 REQ-S07-007 REQ-S07-008 REQ-S07-009 REQ-S07-010 REQ-S07-011
REQ-S07-012 REQ-S07-013 REQ-S07-014 REQ-S07-015 REQ-S07-017""".split())
P = "docs/delivery/requirements.csv"
base_txt = subprocess.run(["git", "show", "HEAD:" + P], capture_output=True, check=True).stdout.decode()
new_raw = open(P, "rb").read()
base = list(csv.reader(io.StringIO(base_txt, newline="")))
new = list(csv.reader(io.StringIO(new_raw.decode(), newline="")))
h = new[0]; ix = {c: i for i, c in enumerate(h)}
print("mine:", len(MINE))
print("header unchanged:", base[0] == h, "| columns:", len(h))
print("rows base/new:", len(base) - 1, len(new) - 1, "| every row has", len(h), "fields:", all(len(r) == len(h) for r in new))
out = io.StringIO(); csv.writer(out, lineterminator="\n").writerows(new)
print("re-serialises byte-identically (valid quoting, LF):", out.getvalue().encode() == new_raw)
B = {r[0]: r for r in base[1:]}; N = {r[0]: r for r in new[1:]}
print("same ids in same order:", [r[0] for r in base[1:]] == [r[0] for r in new[1:]])
changed = {i for i in N if N[i] != B[i]}
print("changed rows:", len(changed), "| all mine:", changed <= MINE, "| mine unchanged:", sorted(MINE - changed))
print("changes outside status/evidence/notes:", [i for i in changed for c in h if c not in ("status", "evidence", "notes") and N[i][ix[c]] != B[i][ix[c]]])
print("old notes kept as prefix:", all(N[i][ix["notes"]].startswith(B[i][ix["notes"]].strip()) for i in changed))
print("all mine IMPLEMENTED, final_gate DG4:", all(N[i][ix["status"]] == "IMPLEMENTED" and N[i][ix["final_gate"]] == "DG4" for i in MINE))
missing = [(i, p) for i in MINE for p in N[i][ix["evidence"]].split(";") if not os.path.isfile(p)]
print("evidence paths:", sum(len(N[i][ix["evidence"]].split(";")) for i in MINE), "| missing files:", missing)
print("DG4 statuses:", dict(Counter(r[ix["status"]] for r in new[1:] if r[ix["final_gate"]] == "DG4")))
