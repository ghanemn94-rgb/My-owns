# Auditor T-DG6-AUDIT-R13: the 48 DG6-final requirements against the register and the three round-12 records.
import csv, json
L = "REQ-DLV-038 REQ-S01-005 REQ-S02-006 REQ-S10-002 REQ-S10-004 REQ-S12-019 REQ-S12-023 REQ-S12-024 REQ-S13-011 REQ-S13-013 REQ-S15-001 REQ-S15-003 REQ-S15-007 REQ-S15-009 REQ-S15-010 REQ-S15-011 REQ-S15-012 REQ-S15-013 REQ-S15-014 REQ-S16-006 REQ-S16-007 REQ-S16-022 REQ-S16-023 REQ-S16-026 REQ-S16-027 REQ-S16-029 REQ-S16-030 REQ-S16-032 REQ-S17-001 REQ-S17-002 REQ-S17-003 REQ-S17-005 REQ-S17-006 REQ-S17-007 REQ-S17-008 REQ-S17-009 REQ-S17-010 REQ-S17-011 REQ-S20-001 REQ-S20-012 REQ-S20-013 REQ-S20-014 REQ-S20-017 REQ-S20-020 REQ-S20-021 REQ-S20-022 REQ-S20-029 REQ-S20-030".split()
rows = {r["req_id"]: r for r in csv.DictReader(open("docs/delivery/requirements.csv", encoding="utf-8"))}
fg = sorted(k for k, r in rows.items() if r["final_gate"] == "DG6")
R = lambda s: set(json.load(open(f"docs/delivery/reviews/DG6/round-12/{s}.json"))["requirements_checked"])
q, d, c = R("qa-verifier"), R("domain-reviewer"), R("code-security-reviewer")
print("assignment list:", len(L), "unique:", len(set(L)), "| register final_gate=DG6:", len(fg), "| equal sets:", set(L) == set(fg))
print("qa:", len(q), "domain:", len(d), "code-security:", len(c))
import os
for x in L:
    r = rows[x]; ev = [p for p in r["evidence"].split(";") if p.strip()]
    miss = [p for p in ev if not os.path.exists(p.strip().split("#")[0])]
    print(f"{x} status={r['status']} qa={x in q} domain={x in d} cs={x in c} rule={'OK' if x in q and (x in d or x in c) else 'FAIL'} evidence={len(ev)} missing={len(miss)}")
print("failing 'qa AND (domain OR code-security)':", [x for x in L if not (x in q and (x in d or x in c))])
print("not IMPLEMENTED:", [x for x in L if rows[x]["status"] != "IMPLEMENTED"])
