# DG1 round-12 domain-reviewer: register + findings check (read-only). Run from the repo root.
import csv, json, os, subprocess
rows = {r["req_id"]: r for r in csv.DictReader(open("docs/delivery/requirements.csv", encoding="utf-8"))}
print("repo HEAD:", subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip())
for a, b in (("32e6478", "987ae02"), ("987ae02", "HEAD")):
    d = subprocess.check_output(["git", "diff", "--stat", a, b, "--", "docs/delivery/requirements.csv"], text=True).strip()
    print(f"register diff {a}..{b} ->", d or "<no change>")
def ev(r):
    paths = [p.strip().split("#")[0] for p in r["evidence"].replace(";", "|").split("|") if p.strip()]
    return paths, [p for p in paths if not os.path.isfile(p)]
assigned = ["REQ-S15-002","REQ-S15-005","REQ-S15-006","REQ-S16-001","REQ-S16-002","REQ-S16-004","REQ-S19-004","REQ-S19-006"]
print("== assigned DG1-final rows (expect IMPLEMENTED, 0 missing)")
for k in assigned:
    r = rows[k]; p, m = ev(r)
    print(k, r["increments"], r["final_gate"], r["status"], "evidence:", len(p), "missing:", m, "|", r["title"][:90])
print("== all DG1-final rows")
for k, r in sorted(rows.items()):
    if r["final_gate"] == "DG1":
        p, m = ev(r); print(k, r["status"], "evidence:", len(p), "missing:", m)
print("== REQ-PB / REQ-S15 / REQ-S16 rows with a P1 increment, not DG1-final (expect no over-claim before their final gate)")
for k, r in sorted(rows.items()):
    if k.startswith(("REQ-PB-", "REQ-S15-", "REQ-S16-")) and "P1" in r["increments"].split(";") and r["final_gate"] != "DG1":
        p, m = ev(r); print(k, r["final_gate"], r["increments"], r["status"], "evidence:", len(p), "missing:", m)
print("== findings status")
f = json.load(open("docs/delivery/findings.json")); arr = f if isinstance(f, list) else f.get("findings", [])
want = ["F-DG1-001","F-DG1-002","F-DG1-003","F-DG1-004","F-DG1-005","F-DG1-006","F-DG1-105","F-DG1-007","F-DG1-008","F-DG1-207","F-DG1-009","F-DG1-210","F-DG1-010","F-DG1-129","F-DG1-213","F-DG1-130","F-DG1-131","F-DG1-011","F-DG1-132","F-DG1-214","F-DG1-215","F-DG1-133"]
for x in arr:
    if x.get("id") in want: print(x["id"], x.get("severity"), x.get("status"), "mandatory:", x.get("mandatory_violation"), "req:", x.get("requirement"))
print("== open Critical/High/mandatory in DG1 (expect none)")
print([x["id"] for x in arr if x.get("id","").startswith("F-DG1-") and x.get("status") not in ("CLOSED_VERIFIED","ACCEPTED_OBSERVATION") and (x.get("severity") in ("Critical","High") or x.get("mandatory_violation"))])
print("== all non-closed DG1 findings")
print([(x["id"], x.get("severity"), x.get("status")) for x in arr if x.get("id","").startswith("F-DG1-") and x.get("status") not in ("CLOSED_VERIFIED","ACCEPTED_OBSERVATION")])
