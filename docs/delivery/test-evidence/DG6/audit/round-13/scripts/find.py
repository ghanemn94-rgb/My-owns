# Auditor T-DG6-AUDIT-R13: every DG6 finding: status, severity, mandatory, owner vs verifier, fix_revision; mirror of sidecars.
import json, glob, re, subprocess, collections
CAND = "2495e036c4d933788044756ab3c41415e3873cf3"
doc = json.load(open("docs/delivery/findings.json"))
d = [f for f in doc["findings"] if f["id"].startswith("F-DG6-")]
print("DG6 findings:", len(d), dict(collections.Counter(f["status"] for f in d)))
nofix = []
for f in d:
    v = f.get("verification") or {}
    fx = f.get("fix_revision")
    anc = None
    if fx and re.fullmatch("[0-9a-f]{40}", fx):
        anc = subprocess.run(["git", "merge-base", "--is-ancestor", fx, CAND]).returncode == 0
    if not fx: nofix.append(f["id"])
    print(f"{f['id']} {f['severity']:<6} mandatory={f['mandatory_violation']} status={f['status']} reporter={f['reported_by']} owner={f['owner']} verified_by={v.get('by_role')} result={v.get('result')} run={(v.get('invocation_reference') or {}).get('run_id','')[:44]} fix_revision={fx or 'ABSENT'} ancestor={anc}")
print("\nnon-owner verification:", all((f.get('verification') or {}).get('by_role') not in (None, f['owner']) for f in d))
print("unresolved Critical/High:", [f['id'] for f in d if f['severity'] in ('Critical','High') and f['status'] not in ('CLOSED_VERIFIED','ACCEPTED_OBSERVATION')])
print("unresolved mandatory:", [f['id'] for f in d if f['mandatory_violation'] and f['status'] not in ('CLOSED_VERIFIED',)])
print(f"\nCLOSED_VERIFIED without a full 40-hex fix_revision: {len(nofix)} of {len(d)}")
print(" ", " ".join(nofix))
print("Validator rule: tools/gates/lib/rules.mjs:742 'CLOSED_VERIFIED needs a full fix_revision commit id'. Precedent: D-184 B1 (DG5, 18 CLOSED_VERIFIED findings without fix_revision -> BLOCKED); D-056 (DG1).")
print("\n== mirror: latest sidecar verification per finding (rounds in numeric order) vs findings.json")
# Latest round that verified the finding; several roles may verify in one round (the importer applies them in the
# fixed order domain, code-security, qa, auditor, so the last applied role is the one recorded in findings.json).
ORDER = ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"]
latest = {}
for p in sorted(glob.glob("docs/delivery/reviews/DG6/round-*/*.verifications.json"), key=lambda p: (int(re.search(r"round-(\d+)", p).group(1)), ORDER.index(p.split("/")[-1].split(".")[0]))):
    role = p.split("/")[-1].split(".")[0]
    for v in json.load(open(p)).get("verifications", []):
        latest[v["finding_id"]] = (p, role, v.get("result"), v.get("status_after"))
mis = 0
for f in d:
    s = latest.get(f["id"])
    ok = s is not None and s[3] == f["status"] and s[1] == (f.get("verification") or {}).get("by_role")
    mis += not ok
    print(f"{f['id']}: sidecar={s[0].split('reviews/DG6/')[1] if s else None} role={s[1] if s else None} {s[2] if s else ''}/{s[3] if s else ''} -> findings.json {f['status']} by {(f.get('verification') or {}).get('by_role')} {'OK' if ok else 'MISMATCH'}")
print("mirror mismatches:", mis)
fs = sorted(glob.glob("docs/delivery/reviews/DG6/round-*/*.findings.json"))
ids = set()
for p in fs:
    for f in json.load(open(p)).get("findings", []): ids.add(f["id"])
print("findings raised in committed sidecars:", len(ids), "; in findings.json:", len(d), "; missing from findings.json:", sorted(ids - {f['id'] for f in d}), "; not in any committed sidecar:", sorted({f['id'] for f in d} - ids))
