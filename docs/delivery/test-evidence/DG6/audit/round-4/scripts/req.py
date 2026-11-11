#!/usr/bin/env python3
"""release-auditor T-DG6-AUDIT-RG-R4: the 48 DG6-final requirements against the register and the three gate records."""
import csv, json

ASSIGNED = """REQ-DLV-038 REQ-S01-005 REQ-S02-006 REQ-S10-002 REQ-S10-004 REQ-S12-019 REQ-S12-023 REQ-S12-024 REQ-S13-011
REQ-S13-013 REQ-S15-001 REQ-S15-003 REQ-S15-007 REQ-S15-009 REQ-S15-010 REQ-S15-011 REQ-S15-012 REQ-S15-013 REQ-S15-014
REQ-S16-006 REQ-S16-007 REQ-S16-022 REQ-S16-023 REQ-S16-026 REQ-S16-027 REQ-S16-029 REQ-S16-030 REQ-S16-032 REQ-S17-001
REQ-S17-002 REQ-S17-003 REQ-S17-005 REQ-S17-006 REQ-S17-007 REQ-S17-008 REQ-S17-009 REQ-S17-010 REQ-S17-011 REQ-S20-001
REQ-S20-012 REQ-S20-013 REQ-S20-014 REQ-S20-017 REQ-S20-020 REQ-S20-021 REQ-S20-022 REQ-S20-029 REQ-S20-030""".split()

rows = list(csv.DictReader(open("docs/delivery/requirements.csv", newline="")))
cols = rows[0].keys()
fg = [r for r in rows if r.get("final_gate") == "DG6"]
reg = sorted(r["id"] if "id" in r else r[list(cols)[0]] for r in fg)
print(f"register columns: {list(cols)}")
print(f"assigned: {len(ASSIGNED)} (unique {len(set(ASSIGNED))}); register final_gate=DG6: {len(reg)}; sets equal: {set(reg) == set(ASSIGNED)}")
print(f"in register not assigned: {sorted(set(reg) - set(ASSIGNED))}; assigned not in register: {sorted(set(ASSIGNED) - set(reg))}")
key = "id" if "id" in cols else list(cols)[0]
status_col = next((c for c in cols if c.lower() in ("status", "state")), None)
if status_col:
    from collections import Counter
    print(f"register {status_col} of the 48: {dict(Counter(r[status_col] for r in fg))}")
recs = {}
for role in ("domain-reviewer", "code-security-reviewer", "qa-verifier"):
    recs[role] = set(json.load(open(f"docs/delivery/reviews/DG6/round-3/{role}.json"))["requirements_checked"])
    print(f"{role} round 3 requirements_checked: {len(recs[role])}; of the 48: {len(recs[role] & set(ASSIGNED))}; outside the 48: {sorted(recs[role] - set(ASSIGNED))}")
bad = [r for r in ASSIGNED if not (r in recs["qa-verifier"] and (r in recs["domain-reviewer"] or r in recs["code-security-reviewer"]))]
print(f"IDs failing 'qa AND (domain OR code-security)': {bad}")
print(f"in qa AND domain: {len([r for r in ASSIGNED if r in recs['qa-verifier'] and r in recs['domain-reviewer']])}; in all three: {len([r for r in ASSIGNED if all(r in s for s in recs.values())])}")
